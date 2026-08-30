// pipeline/test-fixtures/offline-test-rarity-strategies.js
"use strict";
const assert = require("assert");
const { buildDocumentFrequency } = require("../lib/lexical-rarity");
const { strategyA_average, strategyB_max, strategyC_topNAverage, strategyD_filteredAverage } = require("../lib/rarity-strategies");

// Corpus synthetique : "mette" est tres rare (bug reel observe), "vietnam" est aussi rare, "guerre" est courant
const corpus = [
  "Un soldat perdu doit se mette a l'abri pendant la guerre du Vietnam.",
  "Une guerre eclate entre deux royaumes.",
  "La guerre de Secession divise le pays.",
  "Un film sur la guerre froide.",
  "La guerre des etoiles oppose deux camps.",
  "Une simple comedie sans conflit ni guerre.",
];
const df = buildDocumentFrequency(corpus);
const N = corpus.length;

// --- LE BUG REEL : "mette" (verbe conjugue rare) a un IDF tres eleve, comme "vietnam" ---
const matchedWithMette = ["guerre", "mette"];
const avgA = strategyA_average(matchedWithMette, df, N);
console.log(`Strategie A (moyenne) sur ['guerre','mette'] : ${avgA.toFixed(2)} (pollue par 'mette', un mot grammatical)`);

const avgD = strategyD_filteredAverage(matchedWithMette, df, N);
assert(avgD <= 0, "'mette' filtre, il ne reste que 'guerre' (mot omnipresent) -> aucun signal de precision positif, jamais illegitimement eleve comme avec 'mette'");
console.log(`OK  Strategie D (filtree) sur ['guerre','mette'] : ${avgD.toFixed(2)} — 'mette' neutralise (etait ${avgA.toFixed(2)} avec la moyenne brute), le bug reel est corrige`);

// --- Strategie B (max) : un seul terme rare (vietnam) suffit, sans dilution par des mots courants ---
const matchedVietnamPlusCourants = ["guerre", "vietnam", "film"];
const maxB = strategyB_max(matchedVietnamPlusCourants, df, N);
const avgA2 = strategyA_average(matchedVietnamPlusCourants, df, N);
assert(maxB >= avgA2, "le max doit toujours etre au moins aussi eleve que la moyenne (vietnam ne doit jamais etre dilue)");
console.log(`OK  Strategie B (max)=${maxB.toFixed(2)} >= Strategie A (moyenne)=${avgA2.toFixed(2)} — vietnam n'est jamais dilue`);

// --- Strategie C (top-N) : proche du max mais tolere 2 termes rares simultanes ---
const topC = strategyC_topNAverage(matchedVietnamPlusCourants, df, N, 2);
assert(topC >= avgA2);
console.log(`OK  Strategie C (top-2)=${topC.toFixed(2)} >= moyenne globale — capture les 2 termes les plus rares sans dilution par 'film'`);

// --- Test avec UNIQUEMENT des mots grammaticaux -> strategie D renvoie 0 (aucun signal), jamais une erreur ---
const onlyGrammatical = ["mette", "tourne", "mal"];
const dResult = strategyD_filteredAverage(onlyGrammatical, df, N);
assert.strictEqual(dResult, 0);
console.log("OK  si tous les mots trouves sont grammaticaux, strategie D renvoie 0 proprement (pas d'erreur)");

console.log("\n=== TOUS LES TESTS OFFLINE RARITY-STRATEGIES PASSENT ===");
