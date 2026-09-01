// pipeline/lib/structured-query-parser.js
// Parseur DETERMINISTE (pas de LLM ici — Ollama reste un fallback separe,
// non implemente dans ce module). Transforme une requete en :
//   { filters: {actors, directors, year_min, year_max, runtime_min, runtime_max, genres},
//     semantic_query: "texte residuel" }
// PURE, aucun reseau. Reutilise GENRE_WORDS du moteur EXISTANT en LECTURE
// SEULE (jamais modifie).
"use strict";
const { normalizeName, findLongestNameAt } = require("./entity-gazetteer");
const { GENRE_WORDS } = require("./semantic-search-engine");

const ACTOR_MARKERS = ["avec", "mettant en vedette", "avec dans le role principal"];
const DIRECTOR_MARKERS = ["realise par", "réalisé par", "dirige par", "dirigé par", "un film de", "de "];

function normalizeQuery(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

/** Cherche toutes les occurrences d'un marqueur suivi d'un nom connu, retire le segment matche du texte residuel. */
function extractByMarkers(normalizedText, markers, nameMap) {
  const found = [];
  let residual = normalizedText;
  for (const marker of markers) {
    let searchFrom = 0;
    while (true) {
      const idx = residual.indexOf(marker, searchFrom);
      if (idx === -1) break;
      const afterMarker = idx + marker.length;
      const match = findLongestNameAt(residual, afterMarker + (residual[afterMarker] === " " ? 1 : 0), nameMap);
      if (match) {
        found.push(match.displayName);
        const fullMatchStart = idx;
        const fullMatchEnd = afterMarker + 1 + match.matchedText.length;
        residual = (residual.slice(0, fullMatchStart) + " " + residual.slice(fullMatchEnd)).replace(/\s+/g, " ").trim();
        searchFrom = 0;
      } else {
        searchFrom = idx + marker.length;
      }
    }
  }
  return { found: [...new Set(found)], residual };
}

/** Annees : "en 2010", "datant de 2010", "annees 2010" (decennie), "entre 2010 et 2015", "apres 2010", "avant 2010". */
function extractYears(text) {
  let year_min = null, year_max = null;
  let residual = text;

  let m = residual.match(/entre (\d{4}) et (\d{4})/);
  if (m) { year_min = parseInt(m[1]); year_max = parseInt(m[2]); residual = residual.replace(m[0], "").trim(); return finish(); }

  m = residual.match(/annees (\d{3})0/);
  if (m) { const decade = parseInt(m[1] + "0"); year_min = decade; year_max = decade + 9; residual = residual.replace(m[0], "").trim(); return finish(); }

  m = residual.match(/apres (\d{4})/);
  if (m) { year_min = parseInt(m[1]); residual = residual.replace(m[0], "").trim(); return finish(); }

  m = residual.match(/avant (\d{4})/);
  if (m) { year_max = parseInt(m[1]); residual = residual.replace(m[0], "").trim(); return finish(); }

  m = residual.match(/(?:en|datant de) (\d{4})/);
  if (m) { year_min = year_max = parseInt(m[1]); residual = residual.replace(m[0], "").trim(); return finish(); }

  function finish() { return { year_min, year_max, residual }; }
  return finish();
}

/** Duree : "moins de 2h", "moins de 120 minutes", "plus de 90 minutes", "entre 1h30 et 2h". */
function extractRuntime(text) {
  let runtime_min = null, runtime_max = null;
  let residual = text;

  function toMinutes(h, mm) { return (h ? parseInt(h) * 60 : 0) + (mm ? parseInt(mm) : 0); }

  let m = residual.match(/entre (\d+)h(\d+)? et (\d+)h(\d+)?/);
  if (m) { runtime_min = toMinutes(m[1], m[2]); runtime_max = toMinutes(m[3], m[4]); residual = residual.replace(m[0], "").trim(); return finish(); }

  m = residual.match(/moins de (\d+)h(\d+)?/);
  if (m) { runtime_max = toMinutes(m[1], m[2]); residual = residual.replace(m[0], "").trim(); return finish(); }
  m = residual.match(/moins de (\d+) minutes/);
  if (m) { runtime_max = parseInt(m[1]); residual = residual.replace(m[0], "").trim(); return finish(); }

  m = residual.match(/plus de (\d+)h(\d+)?/);
  if (m) { runtime_min = toMinutes(m[1], m[2]); residual = residual.replace(m[0], "").trim(); return finish(); }
  m = residual.match(/plus de (\d+) minutes/);
  if (m) { runtime_min = parseInt(m[1]); residual = residual.replace(m[0], "").trim(); return finish(); }

  function finish() { return { runtime_min, runtime_max, residual }; }
  return finish();
}

/** Genres : reutilise GENRE_WORDS existant (lecture seule). Retire les mots matches du residuel. */
function extractGenres(text) {
  const genres = [];
  let residual = text;
  for (const word in GENRE_WORDS) {
    const normalizedWord = normalizeName(word);
    if (residual.includes(normalizedWord)) {
      genres.push(GENRE_WORDS[word]);
      residual = residual.replace(normalizedWord, "").replace(/\s+/g, " ").trim();
    }
  }
  return { genres: [...new Set(genres)], residual };
}

// Pays : le format exact stocke dans facts.countries n'est pas connu avec
// certitude (libelles FR ou EN selon l'import Wikidata) — chaque mot
// declencheur est donc associe a PLUSIEURS variantes acceptables, matchees
// en sous-chaine insensible a la casse/accents cote hard-filter-retrieval.js.
const COUNTRY_WORDS = {
  "francais": ["france"], "francaise": ["france"],
  "americain": ["etats-unis", "united states", "usa", "amerique"], "americaine": ["etats-unis", "united states", "usa", "amerique"],
  "britannique": ["royaume-uni", "united kingdom", "grande-bretagne", "angleterre"],
  "anglais": ["royaume-uni", "united kingdom", "angleterre"], "anglaise": ["royaume-uni", "united kingdom", "angleterre"],
  "allemand": ["allemagne", "germany"], "allemande": ["allemagne", "germany"],
  "italien": ["italie", "italy"], "italienne": ["italie", "italy"],
  "japonais": ["japon", "japan"], "japonaise": ["japon", "japan"],
  "espagnol": ["espagne", "spain"], "espagnole": ["espagne", "spain"],
  "coreen": ["coree", "korea"], "coreenne": ["coree", "korea"],
  "chinois": ["chine", "china"], "chinoise": ["chine", "china"],
  "canadien": ["canada"], "canadienne": ["canada"],
};

/** Pays : retire les mots matches du residuel, renvoie les variantes acceptables (pas un libelle unique — voir COUNTRY_WORDS). */
function extractCountries(text) {
  const variants = [];
  let residual = text;
  for (const word in COUNTRY_WORDS) {
    const normalizedWord = normalizeName(word);
    const re = new RegExp(`\\b${normalizedWord}\\b`);
    if (re.test(residual)) {
      variants.push(...COUNTRY_WORDS[word]);
      residual = residual.replace(re, "").replace(/\s+/g, " ").trim();
    }
  }
  return { countryVariants: [...new Set(variants)], residual };
}

/**
 * Parseur complet. gazetteer = {actorNames, directorNames} construit depuis
 * le vrai catalogue (voir entity-gazetteer.js). Ne modifie jamais le moteur
 * existant — nouveau module isole.
 */
function parseStructuredQuery(queryText, gazetteer) {
  let normalized = normalizeQuery(queryText);

  const directorResult = extractByMarkers(normalized, DIRECTOR_MARKERS, gazetteer.directorNames);
  normalized = directorResult.residual;

  const actorResult = extractByMarkers(normalized, ACTOR_MARKERS, gazetteer.actorNames);
  normalized = actorResult.residual;

  const yearResult = extractYears(normalized);
  normalized = yearResult.residual;

  const runtimeResult = extractRuntime(normalized);
  normalized = runtimeResult.residual;

  const genreResult = extractGenres(normalized);
  normalized = genreResult.residual;

  const countryResult = extractCountries(normalized);
  normalized = countryResult.residual;

  return {
    filters: {
      actors: actorResult.found,
      directors: directorResult.found,
      year_min: yearResult.year_min, year_max: yearResult.year_max,
      runtime_min: runtimeResult.runtime_min, runtime_max: runtimeResult.runtime_max,
      genres: genreResult.genres,
      countryVariants: countryResult.countryVariants,
    },
    semantic_query: normalized.trim(),
  };
}

module.exports = { parseStructuredQuery, normalizeQuery, extractYears, extractRuntime, extractGenres, extractCountries, COUNTRY_WORDS };
