// pipeline/test-fixtures/offline-test-synopsis-search.js
"use strict";
const assert = require("assert");
const { queryTokens, searchBySynopsis } = require("../lib/synopsis-search");

// --- queryTokens : retire les stopwords, garde les mots significatifs ---
const t1 = queryTokens("je veux un film qui fait peur");
assert(t1.includes("film"));
assert(t1.includes("peur"));
assert(!t1.includes("qui"), "les stopwords doivent etre retires");
console.log("OK  queryTokens retire les stopwords et garde les mots significatifs");

// --- searchBySynopsis : trouve un film dont le synopsis correspond, meme si le moteur structure ne comprendrait rien ---
const catalog = [
  { wikidata_id: "Q1", title: "Guerre Oubliée", synopsisText: "Pendant la guerre du Vietnam, un soldat perdu tente de survivre dans la jungle." },
  { wikidata_id: "Q2", title: "Comédie Romantique", synopsisText: "Deux amis d'enfance tombent amoureux lors d'un mariage." },
  { wikidata_id: "Q3", title: "Le Braquage du Siècle", synopsisText: "Une bande de voleurs prépare un braquage minutieux dans une banque." },
];

const r1 = searchBySynopsis(catalog, "un film qui se déroule pendant la guerre du Vietnam");
assert.strictEqual(r1.top[0].movie.wikidata_id, "Q1", "le synopsis mentionnant explicitement le Vietnam doit remonter en premier");
console.log("OK  'guerre du Vietnam' trouve le bon film via son synopsis (le moteur structuré ne le pourrait pas)");

const r2 = searchBySynopsis(catalog, "un film sur un braquage");
assert.strictEqual(r2.top[0].movie.wikidata_id, "Q3");
console.log("OK  'un film sur un braquage' trouve le bon film via son synopsis");

// --- Aucun film ne correspond -> liste vide, pas d'erreur, pas de resultat invente ---
const r3 = searchBySynopsis(catalog, "une histoire de dinosaures sur mars");
assert.strictEqual(r3.top.length, 0, "aucune correspondance ne doit produire une liste vide, jamais un resultat force");
console.log("OK  aucune correspondance textuelle -> liste vide (rien d'inventé)");

console.log("\n=== TOUS LES TESTS OFFLINE SYNOPSIS-SEARCH PASSENT ===");
