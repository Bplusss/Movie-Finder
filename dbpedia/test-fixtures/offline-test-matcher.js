// dbpedia/test-fixtures/offline-test-matcher.js
"use strict";
const assert = require("assert");
const {
  normalizeTitle, wikidataIdFromUri, buildWikidataIndex,
  buildAttributeIndex, buildLabelLookup, matchFilms,
} = require("../lib/matcher");

assert.strictEqual(wikidataIdFromUri("http://www.wikidata.org/entity/Q83495"), "Q83495");
assert.strictEqual(wikidataIdFromUri("http://dbpedia.org/resource/Foo"), null);
console.log("OK  wikidataIdFromUri");

assert.strictEqual(normalizeTitle("Amélie !"), "amelie");
assert.strictEqual(normalizeTitle("The Matrix"), "the matrix");
console.log("OK  normalizeTitle (accents, ponctuation)");

// --- Films cibles pour ce test (3 films, dont un seulement matchable par titre) ---
const films = [
  { wikidata_id: "Q83495", title: "Matrix" },      // aura un lien sameAs direct
  { wikidata_id: "Q186531", title: "Amélie" },      // PAS de lien sameAs -> repli titre
  { wikidata_id: "Q999999", title: "Film Fantôme" }, // ni lien ni titre correspondant
];
const targetIds = new Set(films.map(f => f.wikidata_id));

// --- Triples "sameAs" simulés (comme lus depuis le fichier de liens Wikidata) ---
const sameAsTriples = [
  { subject: "http://dbpedia.org/resource/The_Matrix", predicate: "http://www.w3.org/2002/07/owl#sameAs", object: "http://www.wikidata.org/entity/Q83495", isLiteral: false },
  { subject: "http://dbpedia.org/resource/Some_Other_Film", predicate: "http://www.w3.org/2002/07/owl#sameAs", object: "http://www.wikidata.org/entity/Q11111111", isLiteral: false }, // hors cible -> doit être ignoré
];
const wikidataIndex = buildWikidataIndex(sameAsTriples, targetIds);
assert.strictEqual(wikidataIndex.size, 1, "seule la correspondance dans notre ensemble cible doit être gardée");
assert.strictEqual(wikidataIndex.get("Q83495"), "http://dbpedia.org/resource/The_Matrix");
console.log("OK  buildWikidataIndex (filtré à l'ensemble cible, ignore le hors-périmètre)");

// --- Labels (y compris un label pour Amélie, mais AUCUN sameAs pour elle -> repli titre) ---
const labelTriples = [
  { subject: "http://dbpedia.org/resource/The_Matrix", predicate: "http://www.w3.org/2000/01/rdf-schema#label", object: "The Matrix", lang: "en", isLiteral: true },
  { subject: "http://dbpedia.org/resource/Amelie_(film)", predicate: "http://www.w3.org/2000/01/rdf-schema#label", object: "Amélie", lang: "en", isLiteral: true },
];
const targetUris = new Set(["http://dbpedia.org/resource/The_Matrix", "http://dbpedia.org/resource/Amelie_(film)"]);
const labelIndex = buildAttributeIndex(labelTriples, targetUris, { predicateSuffix: "#label" });
assert.strictEqual(labelIndex.get("http://dbpedia.org/resource/The_Matrix"), "The Matrix");
console.log("OK  buildAttributeIndex (labels, filtré aux URIs cibles)");

const labelLookup = buildLabelLookup(labelIndex);
assert.deepStrictEqual(labelLookup.get("amelie"), ["http://dbpedia.org/resource/Amelie_(film)"]);
console.log("OK  buildLabelLookup (index inversé pour le repli par titre)");

const abstractIndex = new Map([["http://dbpedia.org/resource/The_Matrix", "A hacker discovers reality is a simulation."]]);
const longAbstractIndex = new Map(); // vide volontairement -> teste l'absence propre

const results = matchFilms(films, { wikidataIndex, labelIndex, abstractIndex, longAbstractIndex, labelLookup });

const matrixResult = results.find(r => r.wikidata_id === "Q83495");
assert.strictEqual(matrixResult.matched, true);
assert.strictEqual(matrixResult.match_method, "wikidata_sameas", "priorité au lien Wikidata quand il existe");
assert.strictEqual(matrixResult.abstract, "A hacker discovers reality is a simulation.");
assert.strictEqual(matrixResult.long_abstract, null, "absent proprement, jamais inventé");
console.log("OK  matchFilms (correspondance via sameAs Wikidata, priorité respectée)");

const amelieResult = results.find(r => r.wikidata_id === "Q186531");
assert.strictEqual(amelieResult.matched, true);
assert.strictEqual(amelieResult.match_method, "title_fallback", "repli par titre uniquement car pas de lien Wikidata");
assert.strictEqual(amelieResult.label, "Amélie");
console.log("OK  matchFilms (repli par titre UNIQUEMENT quand le lien Wikidata est absent)");

const ghostResult = results.find(r => r.wikidata_id === "Q999999");
assert.strictEqual(ghostResult.matched, false);
assert(ghostResult.reason.includes("aucun"), "la raison de l'échec doit être explicite");
console.log("OK  matchFilms (échec proprement tracé avec une raison, rien inventé)");

// --- Cas d'ambiguïté : deux ressources DBpedia portent le même titre normalisé ---
const ambiguousLabelIndex = new Map([
  ["http://dbpedia.org/resource/Titanic_1997", "Titanic"],
  ["http://dbpedia.org/resource/Titanic_1953", "Titanic"],
]);
const ambiguousLookup = buildLabelLookup(ambiguousLabelIndex);
const ambiguousFilm = [{ wikidata_id: "Q_TITANIC", title: "Titanic" }];
const ambiguousResult = matchFilms(ambiguousFilm, {
  wikidataIndex: new Map(), labelIndex: ambiguousLabelIndex,
  abstractIndex: new Map(), longAbstractIndex: new Map(), labelLookup: ambiguousLookup,
});
assert.strictEqual(ambiguousResult[0].matched, false);
assert(ambiguousResult[0].reason.includes("ambigu"), "un titre ambigu ne doit JAMAIS être deviné au hasard");
console.log("OK  matchFilms (titre ambigu -> échec explicite, jamais un choix arbitraire)");

console.log("\n=== TOUS LES TESTS OFFLINE MATCHER PASSENT ===");
