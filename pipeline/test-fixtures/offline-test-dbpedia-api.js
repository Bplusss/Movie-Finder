// pipeline/test-fixtures/offline-test-dbpedia-api.js
"use strict";
const assert = require("assert");
const { dbpediaResourceUri, extractAbstract } = require("../lib/dbpedia-api");

assert.strictEqual(dbpediaResourceUri("Amélie"), "http://dbpedia.org/resource/Amélie");
assert.strictEqual(dbpediaResourceUri("The Matrix"), "http://dbpedia.org/resource/The_Matrix");
console.log("OK  dbpediaResourceUri (espaces -> underscores)");

// --- Fixture : forme réaliste du point d'accès Linked Data DBpedia (RDF/JSON) ---
const fixtureJson = {
  "http://dbpedia.org/resource/The_Matrix": {
    "http://dbpedia.org/ontology/abstract": [
      { value: "The Matrix is a 1999 science fiction film.", lang: "en", type: "literal" },
      { value: "Matrix est un film de science-fiction sorti en 1999.", lang: "fr", type: "literal" },
    ],
    "http://www.w3.org/2000/01/rdf-schema#label": [{ value: "The Matrix", lang: "en" }],
  },
};

const abstract = extractAbstract(fixtureJson, "http://dbpedia.org/resource/The_Matrix");
assert.strictEqual(abstract, "The Matrix is a 1999 science fiction film.");
console.log("OK  extractAbstract (choisit la version anglaise)");

const missing = extractAbstract(fixtureJson, "http://dbpedia.org/resource/Film_Inconnu");
assert.strictEqual(missing, null, "une ressource absente doit renvoyer null, jamais une erreur ni une valeur inventée");
console.log("OK  extractAbstract renvoie null proprement si la ressource est absente");

console.log("\n=== TOUS LES TESTS OFFLINE DBPEDIA-API PASSENT ===");
