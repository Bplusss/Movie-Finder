// pipeline/lib/local-catalog.js
// Charge le catalogue LOCAL (fichier JSON, aucune dependance Supabase/Ollama)
// pour le prototype de moteur de recherche. PURE cote lecture de donnees deja
// generees — ne recalcule rien, ne devine rien.
"use strict";
const fs = require("fs");
const path = require("path");
const semantic = require("./semantic-profile-v2");

const DEFAULT_PATH = path.join(__dirname, "..", "test-results", "semantic-enrichment-1018-final.json");

/** Verifie qu'un semantic_profile a la forme attendue (scores 0-10 ou null, tableaux ou null). Ne corrige rien, signale seulement. */
function isProfileStructurallyValid(profile) {
  if (!profile || typeof profile !== "object") return false;
  for (const f of semantic.SCORE_FIELDS) {
    const v = profile[f];
    if (v !== null && (typeof v !== "number" || v < 0 || v > 10)) return false;
  }
  for (const f of semantic.ARRAY_FIELDS) {
    const v = profile[f];
    if (v !== null && !Array.isArray(v)) return false;
  }
  return true;
}

/**
 * Charge le catalogue depuis un fichier JSON local. Renvoie {movies, stats}.
 * stats documente : total charge, doublons de wikidata_id, profils structurellement invalides.
 * N'ELIMINE aucun film (meme avec un profil invalide) — voir semantic-search-engine.js
 * pour comment ces cas sont geres au moment de la recherche (jamais silencieusement ignores).
 */
function loadCatalog(filePath = DEFAULT_PATH) {
  const raw = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error(`${filePath} ne contient pas un tableau de films.`);

  const seen = new Set();
  const duplicates = [];
  let invalidProfileCount = 0;

  for (const movie of data) {
    if (seen.has(movie.wikidata_id)) duplicates.push(movie.wikidata_id);
    seen.add(movie.wikidata_id);
    if (movie.semantic_profile && !isProfileStructurallyValid(movie.semantic_profile)) {
      invalidProfileCount++;
      movie._profileInvalid = true; // marque pour que le moteur l'ignore explicitement, sans le supprimer du catalogue
    }
  }

  return {
    movies: data,
    stats: {
      total: data.length,
      duplicateWikidataIds: duplicates,
      duplicateCount: duplicates.length,
      invalidProfileCount,
      withSemanticProfile: data.filter(m => m.semantic_status === "success").length,
    },
  };
}

function indexByWikidataId(movies) {
  return new Map(movies.map(m => [m.wikidata_id, m]));
}

module.exports = { loadCatalog, indexByWikidataId, isProfileStructurallyValid, DEFAULT_PATH };
