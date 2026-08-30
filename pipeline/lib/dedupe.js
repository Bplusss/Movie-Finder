// pipeline/lib/dedupe.js
// Règle de fusion Wikidata + DBpedia -> un seul movie_id Movie Finder.
// PURE : ne fait aucun accès réseau ni base de données.
"use strict";

/**
 * Règle canonique : le wikidata_id est la clé d'identité d'un film.
 * DBpedia n'a PAS le droit de créer un nouveau film : il ne fait qu'enrichir
 * une ligne déjà existante (créée par l'import Wikidata), retrouvée via
 * owl:sameAs (dbpedia -> wikidata) ou, à défaut, via correspondance
 * titre + année (match approximatif, à valider manuellement si ambigu).
 *
 * @param {Array} wikidataMovies - lignes déjà en base, indexées par wikidata_id
 * @param {Array} dbpediaRecords - { wikidata_id?, title, year, abstract, dbpedia_uri, categories }
 * @returns {{merged: Array, unmatched: Array, conflicts: Array}}
 */
function mergeDbpediaIntoWikidata(wikidataMovies, dbpediaRecords) {
  const byWikidataId = new Map(wikidataMovies.map(m => [m.wikidata_id, m]));
  const byTitleYear = new Map(
    wikidataMovies.map(m => [normalizeKey(m.title, m.year), m])
  );

  const merged = [];
  const unmatched = [];
  const conflicts = [];

  for (const rec of dbpediaRecords) {
    let target = null;

    // 1) Match canonique : owl:sameAs Wikidata (fiable, prioritaire)
    if (rec.wikidata_id && byWikidataId.has(rec.wikidata_id)) {
      target = byWikidataId.get(rec.wikidata_id);
    } else {
      // 2) Repli : titre + année normalisés (approximatif -> signalé, pas fusionné en silence)
      const key = normalizeKey(rec.title, rec.year);
      const candidate = byTitleYear.get(key);
      if (candidate) {
        conflicts.push({ reason: "match_par_titre_annee_a_valider", dbpedia: rec, matched_to: candidate.wikidata_id });
        target = candidate;
      }
    }

    if (!target) {
      unmatched.push(rec); // DBpedia ne crée jamais de nouveau film
      continue;
    }

    merged.push({
      wikidata_id: target.wikidata_id,
      dbpedia_uri: rec.dbpedia_uri,
      synopsis_raw: rec.abstract || null, // texte brut CC BY-SA — à reformuler avant affichage public (cf. DATA_SOURCES.md)
      synopsis_source_license: "CC BY-SA 3.0",
      categories: rec.categories || [],
    });
  }

  return { merged, unmatched, conflicts };
}

function normalizeKey(title, year) {
  const t = (title || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  return `${t}::${year || ""}`;
}

module.exports = { mergeDbpediaIntoWikidata, normalizeKey };
