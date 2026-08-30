// pipeline/test-fixtures/offline-test-retrieval-ranking.js
"use strict";
const assert = require("assert");
const { unionCandidates, rankCandidates } = require("../lib/retrieval-ranking");

const lexicalTop = [{ wikidata_id: "Q1", score: 90 }, { wikidata_id: "Q2", score: 80 }];
const embeddingTop = [{ wikidata_id: "Q3", score: 70 }, { wikidata_id: "Q4", score: 60 }];

const candidates = unionCandidates([lexicalTop, embeddingTop], 2);
assert(candidates.has("Q1"), "Q1 trouve par le lexical doit survivre a l'union, meme absent de l'embedding");
assert(candidates.has("Q3"), "Q3 trouve par l'embedding doit survivre a l'union, meme absent du lexical");
assert.strictEqual(candidates.size, 4);
console.log("OK  unionCandidates conserve tout candidat trouve par AU MOINS UNE source");

const scoreMaps = {
  lexical: new Map([["Q1", 90], ["Q2", 80]]),
  embedding: new Map([["Q3", 70], ["Q4", 60]]),
};
const weights = { lexical: 0.6, embedding: 0.4 };
const ranked = rankCandidates(candidates, scoreMaps, weights);
assert.strictEqual(ranked.length, 4);
const q1 = ranked.find(r => r.wikidata_id === "Q1");
assert.strictEqual(q1.detail.embedding, 0, "Q1 n'a aucun score embedding -> 0, jamais une erreur ni une valeur inventee");
assert.strictEqual(q1.total, Math.round(90 * 0.6 + 0 * 0.4));
console.log("OK  rankCandidates gere proprement l'absence de score dans une source (0, jamais une erreur)");

for (let i = 1; i < ranked.length; i++) assert(ranked[i - 1].total >= ranked[i].total);
console.log("OK  le classement final est correctement trie");

console.log("\n=== TOUS LES TESTS OFFLINE RETRIEVAL-RANKING PASSENT ===");
