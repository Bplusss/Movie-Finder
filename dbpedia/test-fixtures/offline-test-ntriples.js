// dbpedia/test-fixtures/offline-test-ntriples.js
"use strict";
const assert = require("assert");
const { parseLine } = require("../lib/ntriples");

// --- Ligne de label ---
const l1 = parseLine('<http://dbpedia.org/resource/Am%C3%A9lie> <http://www.w3.org/2000/01/rdf-schema#label> "Amélie"@en .');
assert.strictEqual(l1.subject, "http://dbpedia.org/resource/Am%C3%A9lie");
assert.strictEqual(l1.predicate, "http://www.w3.org/2000/01/rdf-schema#label");
assert.strictEqual(l1.object, "Amélie");
assert.strictEqual(l1.lang, "en");
assert.strictEqual(l1.isLiteral, true);
console.log("OK  parseLine (label avec langue)");

// --- Ligne d'abstract avec guillemets échappés et retour à la ligne échappé ---
const l2 = parseLine('<http://dbpedia.org/resource/The_Matrix> <http://dbpedia.org/ontology/abstract> "He said \\"hello\\".\\nSecond line." @en .');
assert.strictEqual(l2.object, 'He said "hello".\nSecond line.');
console.log("OK  parseLine (échappements guillemets + retour à la ligne)");

// --- Ligne sameAs (URI en objet, pas une chaîne) ---
const l3 = parseLine('<http://dbpedia.org/resource/The_Matrix> <http://www.w3.org/2002/07/owl#sameAs> <http://www.wikidata.org/entity/Q83495> .');
assert.strictEqual(l3.object, "http://www.wikidata.org/entity/Q83495");
assert.strictEqual(l3.isLiteral, false);
console.log("OK  parseLine (objet URI, ex. sameAs vers Wikidata)");

// --- Ligne vide, commentaire, ligne corrompue ---
assert.strictEqual(parseLine(""), null);
assert.strictEqual(parseLine("# un commentaire"), null);
assert.strictEqual(parseLine("ceci n'est pas du N-Triples"), null, "une ligne corrompue ne doit jamais planter, juste être ignorée");
console.log("OK  parseLine tolère les lignes vides/commentaires/corrompues sans planter");

console.log("\n=== TOUS LES TESTS OFFLINE NTRIPLES PASSENT ===");
