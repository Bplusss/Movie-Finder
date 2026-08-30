// pipeline/test-fixtures/offline-test-structured-parser.js
"use strict";
const assert = require("assert");
const { buildGazetteer } = require("../lib/entity-gazetteer");
const { parseStructuredQuery } = require("../lib/structured-query-parser");
const { applyHardFilters, checkCompliance } = require("../lib/hard-filter-retrieval");

const catalog = [
  { wikidata_id: "Q1", title: "Gladiator", facts: { year: 2000, runtime_minutes: 155, genres: ["action", "drama"], directors: ["Ridley Scott"], actors: ["Russell Crowe", "Joaquin Phoenix"] } },
  { wikidata_id: "Q2", title: "Master and Commander", facts: { year: 2003, runtime_minutes: 138, genres: ["war"], directors: ["Peter Weir"], actors: ["Russell Crowe"] } },
  { wikidata_id: "Q3", title: "The Nice Guys", facts: { year: 2016, runtime_minutes: 116, genres: ["action", "comedy"], directors: ["Shane Black"], actors: ["Russell Crowe", "Ryan Gosling"] } },
  { wikidata_id: "Q4", title: "Film Sans Russell", facts: { year: 2016, runtime_minutes: 100, genres: ["comedy"], directors: ["X"], actors: ["Autre Acteur"] } },
];
const gazetteer = buildGazetteer(catalog);

{
  const parsed = parseStructuredQuery("un film avec Russell Crowe", gazetteer);
  assert.deepStrictEqual(parsed.filters.actors, ["Russell Crowe"], "doit identifier Russell Crowe entier, pas juste Russell");
  const pool = applyHardFilters(catalog, parsed.filters);
  assert.strictEqual(pool.length, 3);
  assert(!pool.some(m => m.wikidata_id === "Q4"), "Film Sans Russell ne doit JAMAIS apparaitre, quel que soit son score");
  console.log("OK  CAS CENTRAL : 'avec Russell Crowe' identifie le nom complet et exclut mecaniquement les films sans lui");
}

{
  const parsed = parseStructuredQuery("un film avec Russell Crowe des annees 2010", gazetteer);
  assert.strictEqual(parsed.filters.actors[0], "Russell Crowe");
  assert.strictEqual(parsed.filters.year_min, 2010);
  assert.strictEqual(parsed.filters.year_max, 2019);
  console.log("OK  combinaison acteur + decennie correctement extraite ensemble");
}

{
  const parsed = parseStructuredQuery("un film avec Russell Crowe de moins de 2h", gazetteer);
  assert.strictEqual(parsed.filters.runtime_max, 120);
  const pool = applyHardFilters(catalog, parsed.filters);
  assert(!pool.some(m => m.wikidata_id === "Q1"), "Gladiator (155 min) doit etre exclu par le filtre duree");
  assert(pool.some(m => m.wikidata_id === "Q3"), "The Nice Guys (116 min) doit passer");
  console.log("OK  'moins de 2h' exclut mecaniquement Gladiator (155 min), garde The Nice Guys (116 min)");
}

{
  const parsed = parseStructuredQuery("un film des annees 2010 de moins de 2h avec Russell Crowe qui parle de vengeance", gazetteer);
  assert.strictEqual(parsed.filters.actors[0], "Russell Crowe");
  assert.strictEqual(parsed.filters.year_min, 2010);
  assert.strictEqual(parsed.filters.runtime_max, 120);
  assert(parsed.semantic_query.includes("vengeance"), "le texte semantique residuel doit conserver 'vengeance'");
  assert(!parsed.semantic_query.includes("russell"), "le nom deja extrait ne doit plus polluer le texte semantique");
  console.log(`OK  requete combinee entierement decomposee — residuel semantique: "${parsed.semantic_query}"`);
}

{
  const parsed = parseStructuredQuery("un film realise par Ridley Scott", gazetteer);
  assert.deepStrictEqual(parsed.filters.directors, ["Ridley Scott"]);
  console.log("OK  'realise par X' extrait correctement le realisateur");
}

{
  const filters = { actors: ["Russell Crowe"], directors: [], year_min: null, year_max: null, runtime_min: null, runtime_max: null, genres: [] };
  const c1 = checkCompliance(catalog[0], filters);
  assert.strictEqual(c1.compliant, true);
  const c2 = checkCompliance(catalog[3], filters);
  assert.strictEqual(c2.compliant, false);
  assert.deepStrictEqual(c2.violations, ["actors"]);
  console.log("OK  checkCompliance verifie mecaniquement, jamais besoin d'un jugement humain pour les requetes structurees");
}

{
  const parsed = parseStructuredQuery("un film qui fait peur", gazetteer);
  assert.deepStrictEqual(parsed.filters.actors, []);
  const pool = applyHardFilters(catalog, parsed.filters);
  assert.strictEqual(pool.length, catalog.length, "sans filtre dur, aucun film ne doit etre exclu");
  console.log("OK  une requete purement semantique (aucun filtre) laisse tout le catalogue eligible");
}

console.log("\n=== TOUS LES TESTS OFFLINE STRUCTURED-PARSER PASSENT ===");
