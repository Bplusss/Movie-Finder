// pipeline/test-fixtures/offline-test-benchmark-metrics.js
"use strict";
const assert = require("assert");
const { precisionAtK, recallAtK, reciprocalRank, ndcgAtK, evaluate } = require("../lib/benchmark-metrics");

const groundTruth = { relevant: ["A", "B"], acceptable: ["C"] };
const ranking1 = ["A", "C", "X", "Y", "Z"];
const ranking2 = ["X", "Y", "A", "Z", "B"];

assert.strictEqual(precisionAtK(ranking1, groundTruth, 2), 1, "A et C sont tous deux acceptables -> precision@2 = 1");
console.log("OK  precisionAtK calcule correctement sur un cas simple");

assert.strictEqual(reciprocalRank(ranking1, groundTruth), 1, "A (relevant) est en position 1 -> MRR = 1");
assert(Math.abs(reciprocalRank(ranking2, groundTruth) - 1 / 3) < 1e-9, "A (relevant) est en position 3 -> MRR = 1/3");
console.log("OK  reciprocalRank correct selon la position du premier resultat pertinent");

assert.strictEqual(recallAtK(ranking1, groundTruth, 10), 0.5, "seul A des 2 relevant (A,B) est dans le top -> recall = 0.5");
console.log("OK  recallAtK calcule correctement");

assert.strictEqual(recallAtK(["X"], { relevant: [] }, 10), null, "un ground truth sans 'relevant' doit renvoyer null, jamais un chiffre invente");
console.log("OK  recallAtK renvoie null si le ground truth est insuffisant (jamais de valeur devinee)");

const ndcgGood = ndcgAtK(ranking1, groundTruth, 5);
const ndcgBad = ndcgAtK(ranking2, groundTruth, 5);
assert(ndcgGood > ndcgBad, "un classement qui remonte les pertinents plus tot doit avoir un NDCG plus eleve");
console.log(`OK  NDCG@5 recompense un meilleur classement (${ndcgGood.toFixed(2)} > ${ndcgBad.toFixed(2)})`);

const full = evaluate(ranking1, groundTruth);
assert(typeof full.precisionAt5 === "number" && typeof full.mrr === "number");
console.log("OK  evaluate() renvoie toutes les metriques ensemble");

console.log("\n=== TOUS LES TESTS OFFLINE BENCHMARK-METRICS PASSENT ===");
