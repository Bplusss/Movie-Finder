// pipeline/test-fixtures/offline-test.js
// Vérifie la logique pure (mapping + dédoublonnage) SANS réseau, avec un
// échantillon de bindings au format exact renvoyé par le point d'accès SPARQL
// de Wikidata (structure vérifiée sur la documentation officielle).
"use strict";
const assert = require("assert");
const { groupBindings, toMovieRow, isUsable, buildWikidataQuery, buildFilmIdsQuery, buildDetailsQuery } = require("../lib/wikidata");
const { mergeDbpediaIntoWikidata } = require("../lib/dedupe");

// --- Fixture : 2 films, l'un avec plusieurs genres/acteurs (lignes multiples) ---
const fixtureBindings = [
  { film: { value: "http://www.wikidata.org/entity/Q1130978" }, filmLabel: { value: "Sideways" },
    date: { value: "2004-01-01T00:00:00Z" }, duration: { value: "126" },
    countryLabel: { value: "États-Unis" }, directorLabel: { value: "Alexander Payne" },
    genreLabel: { value: "drame" }, castLabel: { value: "Paul Giamatti" },
    sitelinks: { value: "42" } },
  { film: { value: "http://www.wikidata.org/entity/Q1130978" }, filmLabel: { value: "Sideways" },
    date: { value: "2004-01-01T00:00:00Z" }, duration: { value: "126" },
    countryLabel: { value: "États-Unis" }, directorLabel: { value: "Alexander Payne" },
    genreLabel: { value: "comédie" }, castLabel: { value: "Thomas Haden Church" },
    sitelinks: { value: "42" } },
  { film: { value: "http://www.wikidata.org/entity/Q999999" }, filmLabel: { value: "Film Incomplet" },
    sitelinks: { value: "16" } }, // pas assez de métadonnées -> doit être ignoré
];

// 1) buildWikidataQuery produit bien une chaîne SPARQL avec les bons paramètres
const q = buildWikidataQuery({ offset: 200, limit: 50, minSitelinks: 20 });
assert(q.includes("OFFSET 200"), "offset absent de la requête");
assert(q.includes("LIMIT 50"), "limit absent de la requête");
assert(q.includes(">= 20"), "seuil de notoriété absent de la requête");
console.log("OK  buildWikidataQuery");

// 1bis) la stratégie en 2 étapes (légère) : requête d'ids simple, puis requête
// de détails restreinte via VALUES sur un petit lot d'ids donnés.
const qIds = buildFilmIdsQuery({ offset: 100, limit: 50 });
assert(qIds.includes("OFFSET 100"), "offset absent de la requête d'ids");
assert(qIds.includes("LIMIT 50"), "limit absent de la requête d'ids");
assert(!qIds.includes("OPTIONAL"), "la requête d'ids doit rester simple, sans OPTIONAL");
assert(!qIds.includes("FILTER"), "la requête d'ids ne doit plus filtrer sur sitelinks (trop coûteux)");
console.log("OK  buildFilmIdsQuery (requête minimale, un seul motif de triplet)");

const qDetails = buildDetailsQuery(["http://www.wikidata.org/entity/Q1130978", "http://www.wikidata.org/entity/Q999999"]);
assert(qDetails.includes("VALUES ?film { wd:Q1130978 wd:Q999999 }"), "VALUES doit restreindre aux ids donnés");
console.log("OK  buildDetailsQuery (restreinte via VALUES, donc bon marché même avec beaucoup d'OPTIONAL)");

// 2) groupBindings fusionne bien les lignes multiples d'un même film
const grouped = groupBindings(fixtureBindings);
assert.strictEqual(grouped.length, 2, "devrait regrouper en 2 films distincts");
const sideways = grouped.find(f => f.wikidata_id === "Q1130978");
assert.strictEqual(sideways.genres.size, 2, "devrait avoir 2 genres distincts (comedy, drama)");
assert.strictEqual(sideways.cast.size, 2, "devrait avoir 2 acteurs distincts");
console.log("OK  groupBindings (dédoublonnage multi-lignes)");

// 3) toMovieRow + isUsable filtrent correctement
const rows = grouped.map(toMovieRow);
const usable = rows.filter(isUsable);
assert.strictEqual(usable.length, 1, "un seul des deux films a assez de métadonnées");
assert.strictEqual(usable[0].wikidata_id, "Q1130978");
assert.deepStrictEqual(usable[0].genres.sort(), ["comedy", "drama"]);
console.log("OK  toMovieRow / isUsable (le film incomplet est bien exclu, pas deviné)");

// 4) dédoublonnage DBpedia : fusion par wikidata_id canonique, pas de doublon créé
const wikidataMovies = [{ wikidata_id: "Q1130978", title: "Sideways", year: 2004 }];
const dbpediaRecords = [
  { wikidata_id: "Q1130978", dbpedia_uri: "http://dbpedia.org/resource/Sideways", abstract: "Résumé DBpedia brut." },
  { wikidata_id: "Q_INCONNU_DE_WIKIDATA", title: "Film Fantôme", year: 2004, dbpedia_uri: "http://dbpedia.org/resource/Fantome", abstract: "..." },
];
const { merged, unmatched } = mergeDbpediaIntoWikidata(wikidataMovies, dbpediaRecords);
assert.strictEqual(merged.length, 1, "un seul film fusionné");
assert.strictEqual(merged[0].wikidata_id, "Q1130978");
assert.strictEqual(merged[0].synopsis_source_license, "CC BY-SA 3.0");
assert.strictEqual(unmatched.length, 1, "le film sans correspondance Wikidata ne doit PAS être créé");
console.log("OK  mergeDbpediaIntoWikidata (aucun doublon, aucune création orpheline)");

console.log("\n=== TOUS LES TESTS OFFLINE DU PIPELINE PASSENT ===");
