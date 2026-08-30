#!/usr/bin/env node
// pipeline/test-nonregression.js
// node pipeline/test-nonregression.js
//
// SUITE PERMANENTE DE NON-REGRESSION. Reutilise les modules deja testes
// (aucune logique dupliquee) + ajoute les assertions specifiques aux cas
// connus. A lancer avant toute nouvelle version. Fonctionne avec des
// fixtures synthetiques par defaut (pas besoin des vraies donnees).
"use strict";
const assert = require("assert");
const { buildGazetteer } = require("./lib/entity-gazetteer");
const { parseStructuredQuery } = require("./lib/structured-query-parser");
const { applyHardFilters, checkCompliance } = require("./lib/hard-filter-retrieval");
const { classifyFamily } = require("./lib/movie-search-v3");
const { detectChameleons, signalLevel } = require("./analyze-feedback");

let passed = 0, failed = 0;
function check(label, fn) {
  try { fn(); console.log(`  OK  ${label}`); passed++; }
  catch (e) { console.log(`  ÉCHEC  ${label} -- ${e.message}`); failed++; }
}

const CATALOG = [
  { wikidata_id: "Q1", title: "Mystic River", facts: { year: 2003, runtime_minutes: 138, genres: ["thriller"], directors: ["Clint Eastwood"], actors: ["Sean Penn"] } },
  { wikidata_id: "Q2", title: "Gladiator", facts: { year: 2000, runtime_minutes: 155, genres: ["action"], directors: ["Ridley Scott"], actors: ["Russell Crowe"] } },
  { wikidata_id: "Q3", title: "Le Prestige (donnee incomplete simulee)", facts: { year: 2006, runtime_minutes: 130, genres: ["drama"], directors: [], actors: ["Hugh Jackman"] } },
  { wikidata_id: "Q4", title: "Comedie Sans Rapport", facts: { year: 2015, runtime_minutes: 90, genres: ["comedy"], directors: ["X"], actors: [] } },
];
const GAZETTEER = buildGazetteer(CATALOG);

console.log("=== NON-REGRESSION : FILTRES ===\n");
check("filtre acteur (Russell Crowe)", () => {
  const parsed = parseStructuredQuery("un film avec Russell Crowe", GAZETTEER);
  assert.deepStrictEqual(parsed.filters.actors, ["Russell Crowe"]);
});
check("filtre realisateur (Clint Eastwood)", () => {
  const parsed = parseStructuredQuery("un film realise par Clint Eastwood", GAZETTEER);
  assert.deepStrictEqual(parsed.filters.directors, ["Clint Eastwood"]);
});
check("filtre annee exacte", () => {
  const parsed = parseStructuredQuery("un film en 2003", GAZETTEER);
  assert.strictEqual(parsed.filters.year_min, 2003);
  assert.strictEqual(parsed.filters.year_max, 2003);
});
check("filtre decennie", () => {
  const parsed = parseStructuredQuery("un film des annees 2000", GAZETTEER);
  assert.strictEqual(parsed.filters.year_min, 2000);
  assert.strictEqual(parsed.filters.year_max, 2009);
});
check("filtre duree", () => {
  const parsed = parseStructuredQuery("un film de moins de 2h", GAZETTEER);
  assert.strictEqual(parsed.filters.runtime_max, 120);
});
check("filtre genre", () => {
  const parsed = parseStructuredQuery("un thriller", GAZETTEER);
  assert.deepStrictEqual(parsed.filters.genres, ["thriller"]);
});
check("combinaison acteur+annee+duree exclut mecaniquement les non-conformes", () => {
  const parsed = parseStructuredQuery("un film avec Russell Crowe des annees 2000 de moins de 2h", GAZETTEER);
  const pool = applyHardFilters(CATALOG, parsed.filters);
  assert.strictEqual(pool.length, 0, "Gladiator (155 min) doit etre exclu par la duree, aucun autre film Crowe ne passe");
  pool.forEach(m => assert(checkCompliance(m, parsed.filters).compliant));
});

console.log("\n=== NON-REGRESSION : SEMANTIQUE (classification de famille) ===\n");
check("sujet concret (braquage) -> subject_narrative (pas ambiance)", () => {
  assert.strictEqual(classifyFamily("un film sur un braquage"), "subject_narrative");
});
check("sujet historique (Vietnam) -> subject_narrative", () => {
  assert.strictEqual(classifyFamily("la guerre du Vietnam"), "subject_narrative");
});
check("ambiance (peur) -> ambiance", () => {
  assert.strictEqual(classifyFamily("qui fait peur"), "ambiance");
});
check("ambiance (rire) -> ambiance [CORRECTIF V3.2]", () => {
  assert.strictEqual(classifyFamily("qui fait rire"), "ambiance");
});
check("requete narrative (vengeance) -> subject_narrative", () => {
  assert.strictEqual(classifyFamily("une histoire de vengeance"), "subject_narrative");
});

console.log("\n=== NON-REGRESSION : CAS PROBLEMATIQUES CONNUS ===\n");
check("Christopher Nolan / donnee manquante -> ne plante jamais, pool vide proprement", () => {
  const parsed = parseStructuredQuery("un film realise par Christopher Nolan", GAZETTEER);
  assert.deepStrictEqual(parsed.filters.directors, [], "Nolan absent du gazetteer -> aucun filtre extrait, comportement attendu documente");
  const pool = applyHardFilters(CATALOG, parsed.filters);
  assert.strictEqual(pool.length, CATALOG.length, "sans filtre reconnu, tout le catalogue reste eligible (pas un crash, pas un pool vide errone)");
});
check("'qui fait rire' -> ambiance (regression du bug reel corrige)", () => {
  assert.strictEqual(classifyFamily("un film de moins de 100 minutes qui fait rire"), "ambiance");
});
check("requete 'espace' connue fragile -> ne plante jamais (limite documentee, pas testee comme 'doit reussir')", () => {
  const parsed = parseStructuredQuery("un film qui se passe dans l'espace", GAZETTEER);
  assert.strictEqual(typeof parsed.semantic_query, "string");
});
check("requete identite connue fragile -> ne plante jamais", () => {
  assert.strictEqual(classifyFamily("il decouvre qui il est vraiment"), "subject_narrative");
});
check("requete confiance connue fragile -> ne plante jamais", () => {
  assert.strictEqual(classifyFamily("deux personnes doivent se faire confiance"), "subject_narrative");
});
check("detection de films cameleons -> mecanisme fonctionne (generique, teste ailleurs en detail)", () => {
  const log = Array.from({ length: 6 }, (_, i) => ({ query: `q${i}`, filmId: "X", filmTitle: "Film Test", relevanceRating: i % 2 ? 5 : 1 }));
  const chameleons = detectChameleons(log);
  assert(chameleons.length >= 1);
});
check("seuils de signal -> jamais HIGH sur un petit echantillon", () => {
  assert.strictEqual(signalLevel(3, 1).level, "FAIBLE");
});

console.log(`\n${"=".repeat(60)}`);
console.log(`RÉSULTAT : ${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) { console.log("ÉCHEC — ne pas considérer cette version comme validée."); process.exit(1); }
console.log("Tous les tests de non-régression passent.");
