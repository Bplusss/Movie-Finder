// pipeline/lib/semantic-profile-v2.js
// Schema v2 (null-tolerant) : humor/action/violence/tension/romance/emotional/
// complexity/feel_good/darkness/family_friendly + tone/moods/themes/keywords/good_for.
// PURE (aucun reseau ici) : construction du prompt + validation stricte.
// null est un signal LEGITIME ("ne peut pas etre determine"), pas une erreur —
// seul un type incorrect (ni nombre ni null) ou hors bornes est rejete.
"use strict";

const SCORE_FIELDS = [
  "humor", "action", "violence", "tension", "romance",
  "emotional", "complexity", "feel_good", "darkness", "family_friendly",
];
const ARRAY_FIELDS = ["tone", "moods", "themes", "keywords", "good_for"];
const ALL_FIELDS = [...SCORE_FIELDS, ...ARRAY_FIELDS];

const SYSTEM_PROMPT = `Tu es un analyste de films pour un moteur de recommandation (Movie Finder).
On te donne des faits (Wikidata) et un texte source (introduction et/ou section
Synopsis/Plot Wikipedia) concernant UN SEUL film precis, nomme apres "Titre:".

ATTENTION SOURCE : le texte source peut etre bruite, tronque, ou — plus rarement —
porter par erreur sur un chapitre, un scenario, ou meme un AUTRE film de la meme
franchise. Analyse UNIQUEMENT le film nomme apres "Titre:". Si le texte fourni ne
correspond manifestement pas a ce titre, ignore les details suspects et base ton
analyse sur les faits Wikidata (genre, annee) plutot que sur un contenu douteux.

Produis UNIQUEMENT un objet JSON avec EXACTEMENT ces 15 champs, ni plus ni moins :

{
  "tone": [...],       // ex: "leger", "serieux", "dramatique", "comique", "sombre"
  "moods": [...],      // ex: "feelgood", "angoissant", "nostalgique", "epique"
  "humor": 0-10 ou null,
  "action": 0-10 ou null,
  "violence": 0-10 ou null,
  "tension": 0-10 ou null,
  "romance": 0-10 ou null,
  "emotional": 0-10 ou null,
  "complexity": 0-10 ou null,
  "feel_good": 0-10 ou null,
  "darkness": 0-10 ou null,
  "family_friendly": 0-10 ou null,
  "themes": [...],     // ex: "amitie", "vengeance", "famille", "identite"
  "keywords": [...],   // termes precis, ex: "enquete policiere", "voyage dans le temps"
  "good_for": [...]    // ex: "soiree entre amis", "soiree en couple", "en famille"
}

DEFINITION PRECISE DE CHAQUE SCORE (0 a 10) :
- humor : 0 = aucun element comique, 10 = comedie omnipresente
- action : 0 = aucune scene d'action, 10 = action omnipresente
- violence : 0 = aucune violence, 10 = tres violent
- tension : 0 = aucune tension/suspense, 10 = suspense extreme
- romance : 0 = aucune dimension romantique, 10 = romance centrale
- emotional : 0 = tres peu emotionnel, 10 = extremement emouvant
- complexity : 0 = intrigue tres simple, 10 = intrigue particulierement complexe
- feel_good : 0 = tres sombre/deprimant, 10 = tres feel-good
- darkness : 0 = tres leger, 10 = extremement sombre
- family_friendly : 0 = clairement pas pour les enfants, 10 = parfaitement familial

REGLES STRICTES, A RESPECTER SANS EXCEPTION :
- Ta tache n'est PAS de resumer l'histoire du film. Ta tache est UNIQUEMENT de
  produire les 15 champs ci-dessus, rien d'autre.
- N'utilise JAMAIS un format alternatif comme {"synopsis": ...}, {"plot": ...},
  {"summary": ...}, {"content": ...}, {"scenario": ...}, {"title": ..., "characters": ...}
  ou toute autre structure narrative. Le SEUL format accepte est exactement les
  15 champs listes ci-dessus, avec ces noms exacts.
- N'ajoute JAMAIS de champ qui n'est pas dans la liste des 15.
- N'ecris aucun texte avant ou apres l'objet JSON. Pas de balises markdown.
- N'INVENTE JAMAIS une caracteristique que le texte fourni ne permet pas de
  raisonnablement deduire. Si tu ne peux pas juger un score avec une confiance
  suffisante, mets sa valeur a null plutot que d'inventer un chiffre. null est
  une reponse tout a fait acceptable et PREFERABLE a une estimation hasardeuse.
  Un champ incertain reste PRESENT avec la valeur null — ne le supprime jamais.
- Ne confonds JAMAIS la qualite du film avec ses caracteristiques. Un film peut
  etre excellent tout en ayant feel_good=1 et darkness=9 : la qualite n'entre
  dans AUCUN de ces scores.`;

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
  const textBlock = textParts.length ? textParts.join("\n\n")
    : "(Aucun texte Wikipedia disponible — base ton analyse uniquement sur les faits ci-dessus ; utilise null pour tout score que ces seuls faits ne permettent pas de juger.)";

  return `${facts}\n\n${textBlock}`;
}

/**
 * Etape de normalisation SEPAREE, appliquee AVANT la validation, pour un seul
 * cas mecanique connu : un champ tableau renvoye comme chaine simple quand il
 * n'y a qu'un element (ex. "tone": "sombre" au lieu de "tone": ["sombre"]).
 * NE TOUCHE JAMAIS a null : null reste null (signal volontaire d'incertitude,
 * different de [] qui signifierait "aucun tag identifie").
 * N'est appelee QUE sur un objet deja verifie structurellement complet — elle
 * ne traite donc jamais un champ "absent" (voir checkStructure ci-dessous).
 */
function normalizeArrayFields(obj) {
  const normalized = { ...obj };
  const corrections = [];
  for (const field of ARRAY_FIELDS) {
    const v = obj[field];
    if (v === null) continue; // reste tel quel — jamais transforme en []
    if (typeof v === "string") {
      normalized[field] = v.trim() ? [v.trim()] : [];
      corrections.push(field);
    }
  }
  return { normalized, corrections };
}

/**
 * Verification STRUCTURELLE stricte, avant toute normalisation/validation de
 * type : chaque champ attendu doit exister en tant que CLE dans l'objet
 * (meme si sa valeur est null). Un champ absent n'est PAS equivalent a null —
 * c'est un profil invalide, point final. C'est ce qui empeche un JSON hors
 * schema (ou {}) de passer comme "valide avec des null".
 */
function checkStructure(obj) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ok: false, missingFields: [], presentCount: 0, reason: "la reponse n'est pas un objet JSON" };
  }
  const presentCount = ALL_FIELDS.filter(f => Object.prototype.hasOwnProperty.call(obj, f)).length;
  const missingFields = ALL_FIELDS.filter(f => !Object.prototype.hasOwnProperty.call(obj, f));
  return { ok: missingFields.length === 0, missingFields, presentCount };
}

/**
 * Valide la reponse du LLM. Ordre strict :
 *   1. parse JSON
 *   2. verification structurelle (tous les champs presents en tant que cle)
 *   3. normalisation string -> array
 *   4. validation des types/bornes
 * null est ACCEPTE pour les scores ET pour les champs tableau — mais
 * UNIQUEMENT s'il a ete explicitement renvoye, jamais devine pour un champ
 * absent. La reponse brute est toujours conservee pour audit, valide ou non.
 *
 * options.debug=true : log temporaire de diagnostic (a retirer une fois
 * le pipeline confirme fiable).
 */
function parseAndValidate(rawText, options = {}) {
  const debug = options.debug === true;
  let obj;
  try {
    const clean = rawText.replace(/```json|```/g, "").trim();
    obj = JSON.parse(clean);
  } catch (e) {
    if (debug) console.log(`DEBUG parseAndValidate — JSON.parse a echoue : ${e.message}`);
    return { valid: false, errorType: "invalid_json", error: `JSON invalide : ${e.message}`, rawResponse: rawText, corrections: [] };
  }

  const structure = checkStructure(obj);
  if (debug) console.log(`DEBUG structure — ok=${structure.ok}${structure.missingFields && structure.missingFields.length ? ` manquants=[${structure.missingFields.join(", ")}]` : ""}${structure.reason ? ` (${structure.reason})` : ""}`);
  if (!structure.ok) {
    if (structure.reason) {
      return { valid: false, errorType: "invalid_structure", error: structure.reason, rawResponse: rawText, corrections: [] };
    }
    // Aucun de nos 15 champs present = le modele a repondu avec un schema totalement
    // different (synopsis/plot/scenario/...), pas juste un oubli de champ.
    const errorType = structure.presentCount === 0 ? "wrong_schema" : "missing_fields";
    return { valid: false, errorType, error: `champs manquants : ${structure.missingFields.join(", ")}`, rawResponse: rawText, corrections: [] };
  }

  const { normalized, corrections } = normalizeArrayFields(obj);

  if (debug) {
    for (const field of ARRAY_FIELDS) {
      const before = obj[field];
      const after = normalized[field];
      const typeOf = v => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
      console.log(`DEBUG avant validation — ${field}: avant=${JSON.stringify(before)} (${typeOf(before)}) -> apres normalisation=${JSON.stringify(after)} (${typeOf(after)})`);
    }
  }

  const errors = [];
  const profile = {};

  for (const field of SCORE_FIELDS) {
    const v = normalized[field];
    if (v === null) { profile[field] = null; continue; }
    if (typeof v !== "number" || Number.isNaN(v)) { errors.push(`${field} : type invalide (${typeof v})`); continue; }
    if (v < 0 || v > 10) { errors.push(`${field} : hors bornes 0-10 (${v})`); continue; }
    profile[field] = Math.round(v * 10) / 10;
  }

  for (const field of ARRAY_FIELDS) {
    const v = normalized[field];
    if (v === null) { profile[field] = null; continue; } // reste null, JAMAIS transforme en []
    if (!Array.isArray(v)) { errors.push(`${field} : doit etre un tableau (ou null)`); continue; }
    profile[field] = v.filter(x => typeof x === "string");
  }

  if (errors.length) return { valid: false, errorType: "invalid_types", error: errors.join("; "), rawResponse: rawText, corrections };
  return { valid: true, profile, rawResponse: rawText, corrections };
}

/** Compte les null EXPLICITES sur TOUS les champs (scores + tableaux). */
function countNulls(profile) {
  return ALL_FIELDS.filter(f => profile[f] === null).length;
}

module.exports = { SCORE_FIELDS, ARRAY_FIELDS, ALL_FIELDS, SYSTEM_PROMPT, buildPrompt, normalizeArrayFields, checkStructure, parseAndValidate, countNulls };
