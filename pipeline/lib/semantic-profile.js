// pipeline/lib/semantic-profile.js
// Logique PURE (aucun reseau ici) : construction du prompt d'enrichissement
// semantique et validation stricte de la reponse du LLM. Le LLM ne doit
// JAMAIS ecrire un nouveau synopsis — uniquement analyser le texte fourni.
"use strict";

const SCORE_FIELDS = [
  "humor", "intensity", "violence", "complexity", "feel_good",
  "romance", "darkness", "action", "suspense", "emotional_intensity", "pace",
];

const SYSTEM_PROMPT = `Tu es un analyste de films pour un moteur de recommandation (Movie Finder).
On te donne des faits structures (Wikidata) et le texte d'un article Wikipedia
(introduction et, si disponible, une section Synopsis/Plot) pour UN SEUL film.

Ta tache : produire UNIQUEMENT un objet JSON structure avec des
caracteristiques semantiques utiles a la recommandation. Reponds SEULEMENT
avec du JSON valide, sans texte autour, sans balises markdown.

INTERDICTIONS STRICTES :
- N'ECRIS PAS de nouveau synopsis ou resume narratif. Ton role est d'ANALYSER
  le texte fourni, pas de le reformuler ni de le remplacer.
- N'invente AUCUN fait sur le film (casting, intrigue) qui ne serait pas dans
  le texte fourni.
- Si le texte fourni est insuffisant pour juger un aspect avec certitude,
  fais une estimation prudente et reflete cette incertitude dans "confidence"
  et "data_quality" plutot que d'inventer un score confiant.

Format de reponse exact :
{
  "moods": ["quelques mots simples parmi ex: leger, drole, sombre, tendu, emouvant, romantique, feelgood, familial, angoissant, epique, reflexif, nostalgique, aventureux, violent, absurde, chaleureux, triste, optimiste"],
  "themes": ["grands themes narratifs, ex: amitie, amour, famille, vengeance, guerre, crime, justice, trahison, survie, adolescence, deuil, identite, politique, pouvoir, quete, redemption"],
  "tags": ["tags precis et reutilisables, ex: enquete policiere, voyage dans le temps, braquage, road trip, huis clos, tueur en serie"],
  "humor": 0-10, "intensity": 0-10, "violence": 0-10, "complexity": 0-10,
  "feel_good": 0-10, "romance": 0-10, "darkness": 0-10, "action": 0-10,
  "suspense": 0-10, "emotional_intensity": 0-10, "pace": 0-10,
  "confidence": 0-1,
  "data_quality": "high" | "medium" | "low"
}`;

/** Construit le contenu utilisateur envoye au LLM pour UN film. */
function buildPrompt(film) {
  const facts = [
    `Titre: ${film.title}`,
    film.year ? `Annee: ${film.year}` : null,
    film.runtime_minutes ? `Duree: ${film.runtime_minutes} minutes` : null,
    film.countries && film.countries.length ? `Pays: ${film.countries.join(", ")}` : null,
    film.genres && film.genres.length ? `Genres (Wikidata): ${film.genres.join(", ")}` : null,
    film.directors && film.directors.length ? `Realisateur(s): ${film.directors.join(", ")}` : null,
    film.actors && film.actors.length ? `Acteurs principaux: ${film.actors.slice(0, 6).join(", ")}` : null,
  ].filter(Boolean).join("\n");

  const textParts = [];
  if (film.intro_text) textParts.push(`Introduction Wikipedia:\n${film.intro_text}`);
  if (film.synopsis_text) textParts.push(`Section Synopsis/Plot:\n${film.synopsis_text}`);
  const textBlock = textParts.length ? textParts.join("\n\n") : "(Aucun texte Wikipedia disponible pour ce film — base ton analyse uniquement sur les faits ci-dessus, avec une confidence basse.)";

  return `${facts}\n\n${textBlock}`;
}

/**
 * Valide et nettoie la reponse JSON du LLM (pure). Ne devine JAMAIS une
 * valeur manquante : un champ score absent ou hors-borne fait echouer la
 * validation pour ce film plutot que d'etre invente silencieusement.
 */
function parseAndValidate(rawText) {
  let obj;
  try {
    const clean = rawText.replace(/```json|```/g, "").trim();
    obj = JSON.parse(clean);
  } catch (e) {
    return { valid: false, error: `JSON invalide : ${e.message}` };
  }

  const errors = [];
  for (const field of SCORE_FIELDS) {
    const v = obj[field];
    if (typeof v !== "number" || Number.isNaN(v)) { errors.push(`${field} manquant ou non numerique`); continue; }
    if (v < 0 || v > 10) errors.push(`${field} hors bornes (0-10): ${v}`);
  }
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    errors.push(`confidence manquante ou hors bornes (0-1)`);
  }
  if (!["high", "medium", "low"].includes(obj.data_quality)) {
    errors.push(`data_quality invalide : ${obj.data_quality}`);
  }
  if (!Array.isArray(obj.moods)) errors.push("moods doit etre un tableau");
  if (!Array.isArray(obj.themes)) errors.push("themes doit etre un tableau");
  if (!Array.isArray(obj.tags)) errors.push("tags doit etre un tableau");

  if (errors.length) return { valid: false, error: errors.join("; ") };

  // Arrondi propre (le LLM renvoie parfois des decimales inutiles sur les scores entiers attendus)
  const profile = { moods: obj.moods, themes: obj.themes, tags: obj.tags };
  for (const f of SCORE_FIELDS) profile[f] = Math.round(obj[f] * 10) / 10;

  return { valid: true, profile, confidence: obj.confidence, data_quality: obj.data_quality };
}

module.exports = { SCORE_FIELDS, SYSTEM_PROMPT, buildPrompt, parseAndValidate };
