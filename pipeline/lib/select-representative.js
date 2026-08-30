// pipeline/lib/select-representative.js
// Logique PURE (aucun reseau/DB ici) : selectionne un echantillon de films
// deliberement varie (genres differents + le plus ancien + le plus recent)
// pour un test de qualite representatif. Testable hors-ligne.
"use strict";

const PRIORITY_GENRES = [
  "comedy", "thriller", "action", "scifi", "romance", "drama",
  "family", "crime", "horror", "adventure", "mystery", "musical",
  "war", "fantasy", "history", "documentary", "animation", "western",
];

/**
 * films: [{wikidata_id, title, year, genres: []}]
 * Renvoie jusqu'a `count` films : le plus ancien, le plus recent, puis un
 * representant de chaque genre prioritaire (dans l'ordre), puis complete si
 * besoin avec les films restants pour atteindre `count`.
 */
function selectRepresentative(films, count = 20) {
  const withYear = films.filter(f => f.year);
  const picked = [];
  const pickedIds = new Set();

  function tryPick(f) {
    if (!f || pickedIds.has(f.wikidata_id)) return false;
    picked.push(f); pickedIds.add(f.wikidata_id);
    return true;
  }

  if (withYear.length) {
    const oldest = [...withYear].sort((a, b) => a.year - b.year)[0];
    const newest = [...withYear].sort((a, b) => b.year - a.year)[0];
    tryPick(oldest);
    tryPick(newest);
  }

  for (const genre of PRIORITY_GENRES) {
    if (picked.length >= count) break;
    const candidate = films.find(f => (f.genres || []).includes(genre) && !pickedIds.has(f.wikidata_id));
    if (candidate) tryPick(candidate);
  }

  for (const f of films) {
    if (picked.length >= count) break;
    tryPick(f);
  }

  return picked.slice(0, count);
}

module.exports = { selectRepresentative, PRIORITY_GENRES };
