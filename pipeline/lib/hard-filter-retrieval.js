// pipeline/lib/hard-filter-retrieval.js
// Retrieval par CONTRAINTES DURES uniquement — jamais un score. Un film qui
// ne respecte pas un filtre est retire du pool AVANT tout classement ; il ne
// peut plus jamais reapparaitre, quel que soit son score semantique. PURE.
"use strict";
const { normalizeName } = require("./entity-gazetteer");

function matchesPerson(moviePersons, requiredNames) {
  if (!requiredNames.length) return true;
  const normalizedMovie = (moviePersons || []).map(normalizeName);
  return requiredNames.every(name => normalizedMovie.includes(normalizeName(name)));
}

/** Applique tous les filtres. Renvoie le pool reduit — deterministe, jamais un score. */
function applyHardFilters(catalog, filters) {
  return catalog.filter(m => {
    if (!matchesPerson(m.facts.actors, filters.actors)) return false;
    if (!matchesPerson(m.facts.directors, filters.directors)) return false;
    if (filters.year_min != null && (!m.facts.year || m.facts.year < filters.year_min)) return false;
    if (filters.year_max != null && (!m.facts.year || m.facts.year > filters.year_max)) return false;
    if (filters.runtime_min != null && (!m.facts.runtime_minutes || m.facts.runtime_minutes < filters.runtime_min)) return false;
    if (filters.runtime_max != null && (!m.facts.runtime_minutes || m.facts.runtime_minutes > filters.runtime_max)) return false;
    if (filters.genres && filters.genres.length && !filters.genres.some(g => (m.facts.genres || []).includes(g))) return false;
    return true;
  });
}

/** Verification mecanique de conformite (utile pour le benchmark : 100% attendu, jamais un jugement humain necessaire). */
function checkCompliance(movie, filters) {
  const violations = [];
  if (!matchesPerson(movie.facts.actors, filters.actors)) violations.push("actors");
  if (!matchesPerson(movie.facts.directors, filters.directors)) violations.push("directors");
  if (filters.year_min != null && (!movie.facts.year || movie.facts.year < filters.year_min)) violations.push("year_min");
  if (filters.year_max != null && (!movie.facts.year || movie.facts.year > filters.year_max)) violations.push("year_max");
  if (filters.runtime_min != null && (!movie.facts.runtime_minutes || movie.facts.runtime_minutes < filters.runtime_min)) violations.push("runtime_min");
  if (filters.runtime_max != null && (!movie.facts.runtime_minutes || movie.facts.runtime_minutes > filters.runtime_max)) violations.push("runtime_max");
  if (filters.genres && filters.genres.length && !filters.genres.some(g => (movie.facts.genres || []).includes(g))) violations.push("genres");
  return { compliant: violations.length === 0, violations };
}

module.exports = { applyHardFilters, checkCompliance, matchesPerson };
