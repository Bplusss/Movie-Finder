// pipeline/test-fixtures/offline-test-wikidata-api.js
"use strict";
const assert = require("assert");
const {
  getClaimValues, bestLabel, extractRawFilm, collectReferencedIds,
  mapGenreLabel, buildFetchedRow, isUsable,
} = require("../lib/wikidata-api");

// --- Fixture : entité "film" réaliste (structure wbgetentities confirmée en direct) ---
const filmEntity = {
  id: "Q999001",
  labels: { fr: { language: "fr", value: "Amélie" }, en: { language: "en", value: "Amélie" } },
  sitelinks: { frwiki: { site: "frwiki", title: "Fabuleux destin d'Amélie Poulain" }, enwiki: { site: "enwiki", title: "Amélie" } },
  claims: {
    P31: [{ mainsnak: { datavalue: { value: { id: "Q11424" } } }, rank: "normal" }],
    P577: [{ mainsnak: { datavalue: { value: { time: "+2001-04-25T00:00:00Z", precision: 11 } } }, rank: "normal" }],
    P2047: [{ mainsnak: { datavalue: { value: { amount: "+122", unit: "minute" } } }, rank: "normal" }],
    P495: [{ mainsnak: { datavalue: { value: { id: "Q142" } } }, rank: "normal" }], // France
    P136: [{ mainsnak: { datavalue: { value: { id: "Q157443" } } }, rank: "normal" }], // comedy film
    P57: [{ mainsnak: { datavalue: { value: { id: "Q313039" } } }, rank: "normal" }], // Jean-Pierre Jeunet
    P161: [
      { mainsnak: { datavalue: { value: { id: "Q102711" } } }, rank: "normal" }, // Audrey Tautou
      { mainsnak: { datavalue: { value: { id: "Q123456" } } }, rank: "deprecated" }, // ne doit PAS être inclus
    ],
    P345: [{ mainsnak: { datavalue: { value: "tt0211915" } } , rank: "normal" }],
  },
};

const raw = extractRawFilm(filmEntity);
assert.strictEqual(raw.wikidata_id, "Q999001");
assert.strictEqual(raw.title, "Amélie");
assert.strictEqual(raw.release_date, "2001-04-25");
assert.strictEqual(raw.runtime_minutes, 122);
assert.strictEqual(raw.imdb_id, "tt0211915");
assert.deepStrictEqual(raw.country_refs, ["Q142"]);
assert.deepStrictEqual(raw.genre_refs, ["Q157443"]);
assert.deepStrictEqual(raw.director_refs, ["Q313039"]);
assert.deepStrictEqual(raw.cast_refs, ["Q102711"], "le claim deprecated ne doit pas être inclus");
console.log("OK  extractRawFilm (dates, durée, imdb, références, exclusion des claims dépréciés)");

// --- Résolution des Q-ids référencés : responsabilité déplacée vers une passe
// séparée (pipeline/lib/wikidata-refs.js), testée dans son propre fichier. ---
const referenced = collectReferencedIds([raw]);
assert.deepStrictEqual(referenced.sort(), ["Q102711", "Q142", "Q157443", "Q313039"].sort());
console.log("OK  collectReferencedIds (dédoublonné, sans le claim deprecated)");

// --- buildFetchedRow : uniquement les données principales, rien sur les références ---
const row = buildFetchedRow(raw);
assert.strictEqual(row.title, "Amélie");
assert.strictEqual(row.year, 2001);
assert.strictEqual(row.runtime_minutes, 122);
assert.strictEqual(row.external_ids.imdb_id, "tt0211915");
assert.strictEqual(row.original_title, null, "jamais deviné, doit rester null");
assert.strictEqual(row.wikipedia_title_en, "Amélie", "conservé pour l'enrichissement DBpedia ultérieur");
assert(row.wikipedia_url.includes("fr.wikipedia.org"));
console.log("OK  buildFetchedRow (données principales uniquement, rien sur les références)");

assert.strictEqual(isUsable(row), true);
console.log("OK  isUsable accepte un film dès que titre + année/durée sont là (pas besoin du genre résolu)");

// --- Un film sans titre ni année/durée n'est pas utilisable ---
const incomplete = buildFetchedRow({ ...raw, title: null, release_date: null, runtime_minutes: null });
assert.strictEqual(isUsable(incomplete), false);
console.log("OK  isUsable rejette un film sans données principales");

// --- Date à précision "année seulement" : jamais une date SQL invalide, mais l'année reste extraite ---
const yearOnlyEntity = {
  ...filmEntity,
  claims: { ...filmEntity.claims, P577: [{ mainsnak: { datavalue: { value: { time: "+2014-00-00T00:00:00Z", precision: 9 } } }, rank: "normal" }] },
};
const rawYearOnly = extractRawFilm(yearOnlyEntity);
assert.strictEqual(rawYearOnly.release_date, null, "precision année seule -> pas de date complète inventée");
assert.strictEqual(rawYearOnly.year_from_date, 2014, "l'année reste extraite malgré l'absence de mois/jour");
const rowYearOnly = buildFetchedRow(rawYearOnly);
assert.strictEqual(rowYearOnly.year, 2014);
assert.strictEqual(rowYearOnly.release_date, null);
console.log("OK  date à précision partielle (année seule) : jamais de date invalide, année tout de même récupérée");

console.log("\n=== TOUS LES TESTS OFFLINE WIKIDATA-API PASSENT ===");
