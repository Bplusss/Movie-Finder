// pipeline/lib/semantic-fallback.js
// Cascade de recuperation progressive pour un film. Chaque niveau reduit le
// bruit/la longueur du contexte transmis au modele plutot que d'allonger le
// prompt. Si les 3 niveaux echouent, le film devient "needs_review" — jamais
// une donnee fabriquee pour forcer une "reussite".
"use strict";
const ollama = require("./ollama-client");
const semantic = require("./semantic-profile-v2");
const { cleanText, truncateAtSentence } = require("./text-cleaner");

// JSON Schema Ollama ("structured outputs") — reprend EXACTEMENT le meme
// schema que la validation JS (semantic-profile-v2.js), comme contrainte
// machine plutot qu'une simple consigne de prompt.
const JSON_SCHEMA = {
  type: "object",
  properties: {
    tone: { type: ["array", "null"], items: { type: "string" } },
    moods: { type: ["array", "null"], items: { type: "string" } },
    humor: { type: ["number", "null"] },
    action: { type: ["number", "null"] },
    violence: { type: ["number", "null"] },
    tension: { type: ["number", "null"] },
    romance: { type: ["number", "null"] },
    emotional: { type: ["number", "null"] },
    complexity: { type: ["number", "null"] },
    feel_good: { type: ["number", "null"] },
    darkness: { type: ["number", "null"] },
    family_friendly: { type: ["number", "null"] },
    themes: { type: ["array", "null"], items: { type: "string" } },
    keywords: { type: ["array", "null"], items: { type: "string" } },
    good_for: { type: ["array", "null"], items: { type: "string" } },
  },
  required: semantic.ALL_FIELDS,
};

function filmHeader(film) {
  return `FILM A ANALYSER (et UNIQUEMENT celui-ci) :\nTitre : ${film.title}\n${film.year ? `Annee : ${film.year}\n` : ""}Si le texte fourni plus bas semble parler d'un autre film, d'un livre ou d'une serie, ignore-le et base ton analyse uniquement sur les faits ci-dessous.\n`;
}

function factsBlock(film) {
  return [
    film.year ? `Annee: ${film.year}` : null,
    film.runtime_minutes ? `Duree: ${film.runtime_minutes} minutes` : null,
    film.countries && film.countries.length ? `Pays: ${film.countries.join(", ")}` : null,
    film.genres && film.genres.length ? `Genres: ${film.genres.join(", ")}` : null,
    film.directors && film.directors.length ? `Realisateur(s): ${film.directors.join(", ")}` : null,
    film.actors && film.actors.length ? `Acteurs: ${film.actors.slice(0, 6).join(", ")}` : null,
  ].filter(Boolean).join("\n");
}

/** Niveau 1 : comportement actuel inchange, texte complet. */
function buildLevel1Prompt(film) {
  return semantic.buildPrompt(film);
}

/** Niveau 2 : contexte nettoye (bruit structurel retire) et raccourci a ~900 caracteres. */
function buildLevel2Prompt(film) {
  const combined = [cleanText(film.intro_text), cleanText(film.synopsis_text)].filter(Boolean).join(" ");
  const text = truncateAtSentence(combined, 900);
  return `${filmHeader(film)}${factsBlock(film)}\n\nSynopsis (nettoye) :\n${text || "(aucun texte exploitable apres nettoyage — base-toi uniquement sur les faits ci-dessus)"}`;
}

/** Niveau 3 : synopsis minimal (l'intro officielle Wikipedia, courte, en priorite). */
function buildLevel3Prompt(film) {
  const preferred = cleanText(film.intro_text) || cleanText(film.synopsis_text);
  const short = truncateAtSentence(preferred, 300);
  return `${filmHeader(film)}${factsBlock(film)}\n\nResume court :\n${short || "(aucun texte disponible — base-toi uniquement sur les faits ci-dessus)"}`;
}

/** Un seul appel + validation, avec repli JSON simple si le schema structure n'est pas supporte par cette version d'Ollama. */
async function tryGenerate(model, userPrompt, useSchema) {
  try {
    const raw = await ollama.generate({
      model, systemPrompt: semantic.SYSTEM_PROMPT, userPrompt,
      jsonSchema: useSchema ? JSON_SCHEMA : undefined,
    });
    return semantic.parseAndValidate(raw);
  } catch (e) {
    if (useSchema) {
      try {
        const raw2 = await ollama.generate({ model, systemPrompt: semantic.SYSTEM_PROMPT, userPrompt });
        return semantic.parseAndValidate(raw2);
      } catch (e2) {
        return { valid: false, errorType: "network_error", error: e2.message, rawResponse: null, corrections: [] };
      }
    }
    return { valid: false, errorType: "network_error", error: e.message, rawResponse: null, corrections: [] };
  }
}

function summarize(level, r) {
  return { level, valid: r.valid, errorType: r.errorType || null, error: r.error || null };
}

/**
 * Cascade complete pour UN film. Ne fabrique JAMAIS de donnees : si les 3
 * niveaux echouent, renvoie status='needs_review' avec l'historique complet
 * des tentatives, jamais un profil invente.
 */
async function runWithFallback(film, { model = "qwen2.5:7b-instruct", useSchema = true } = {}) {
  const attempts = [];

  const r1 = await tryGenerate(model, buildLevel1Prompt(film), false); // niveau 1 = comportement actuel, mode json simple
  attempts.push(summarize(1, r1));
  if (r1.valid) return { status: "success", level: 1, ...r1, attempts };

  const r2 = await tryGenerate(model, buildLevel2Prompt(film), useSchema);
  attempts.push(summarize(2, r2));
  if (r2.valid) return { status: "success", level: 2, ...r2, attempts };

  const r3 = await tryGenerate(model, buildLevel3Prompt(film), useSchema);
  attempts.push(summarize(3, r3));
  if (r3.valid) return { status: "success", level: 3, ...r3, attempts };

  return { status: "needs_review", attempts };
}

module.exports = { runWithFallback, buildLevel1Prompt, buildLevel2Prompt, buildLevel3Prompt, JSON_SCHEMA, filmHeader, factsBlock };
