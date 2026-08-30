// pipeline/test-fixtures/offline-test-embeddings.js
"use strict";
const assert = require("assert");
const { cosineSimilarity } = require("../lib/embeddings");

assert.strictEqual(cosineSimilarity([1, 0], [1, 0]), 1, "vecteurs identiques -> similarite 1");
console.log("OK  vecteurs identiques -> similarite = 1");

assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0, "vecteurs orthogonaux -> similarite 0");
console.log("OK  vecteurs orthogonaux -> similarite = 0");

assert.strictEqual(cosineSimilarity([1, 0], [-1, 0]), -1, "vecteurs opposes -> similarite -1");
console.log("OK  vecteurs opposes -> similarite = -1");

assert.strictEqual(cosineSimilarity([0, 0], [1, 1]), 0, "un vecteur nul ne doit jamais provoquer de division par zero");
console.log("OK  vecteur nul gere sans crash (jamais de division par zero)");

const a = [0.6, 0.8], b = [0.6, 0.8];
assert(Math.abs(cosineSimilarity(a, b) - 1) < 1e-9);
console.log("OK  vecteurs normalises identiques -> proche de 1 (tolerance flottante)");

console.log("\n=== TOUS LES TESTS OFFLINE EMBEDDINGS (cosineSimilarity) PASSENT ===");
console.log("NOTE : embed()/getEmbedder() necessitent le vrai modele telecharge — non testables hors-ligne ici.");
