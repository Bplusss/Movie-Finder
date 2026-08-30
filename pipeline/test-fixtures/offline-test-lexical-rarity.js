// pipeline/test-fixtures/offline-test-lexical-rarity.js
"use strict";
const assert = require("assert");
const { buildDocumentFrequency, idf, scoreWithIdf } = require("../lib/lexical-rarity");

// --- Corpus synthetique : "guerre" est courant (5/6 textes), "vietnam" est rare (1/6) ---
const corpus = [
  "Pendant la guerre du Vietnam, un soldat perdu tente de survivre.",
  "Une guerre eclate entre deux royaumes fantastiques.",
  "La guerre de Secession divise le pays.",
  "Un film sur la guerre froide et l'espionnage.",
  "La guerre des etoiles oppose rebelles et empire.",
  "Une simple comedie romantique sans aucun conflit.",
];
const df = buildDocumentFrequency(corpus);
const N = corpus.length;

// --- Le point CRITIQUE : vietnam (rare) doit avoir un IDF plus eleve que guerre (courant) ---
const idfGuerre = idf("guerre", df, N);
const idfVietnam = idf("vietnam", df, N);
assert(idfVietnam > idfGuerre, "un terme plus rare (vietnam) doit avoir un IDF plus eleve qu'un terme courant (guerre)");
console.log(`OK  IDF('vietnam')=${idfVietnam.toFixed(2)} > IDF('guerre')=${idfGuerre.toFixed(2)} — mesure, pas suppose`);

// --- scoreWithIdf : un texte qui contient le terme RARE doit scorer plus haut qu'un texte avec seulement le terme courant ---
const queryTokens = ["guerre", "vietnam"];
const textWithBoth = corpus[0]; // contient guerre ET vietnam
const textWithCommonOnly = corpus[1]; // contient guerre seulement

const r1 = scoreWithIdf(queryTokens, textWithBoth, df, N);
const r2 = scoreWithIdf(queryTokens, textWithCommonOnly, df, N);
assert(r1.score > r2.score, "le texte contenant le terme rare (vietnam) EN PLUS doit scorer nettement plus haut");
console.log(`OK  score('guerre'+'vietnam' trouves)=${r1.score} > score('guerre' seul trouve)=${r2.score}`);

// --- avgIdf permet de distinguer une requete a mots rares d'une requete a mots courants ---
const rareQuery = scoreWithIdf(["vietnam"], corpus[0], df, N);
const commonQuery = scoreWithIdf(["guerre"], corpus[0], df, N);
assert(rareQuery.avgIdf > commonQuery.avgIdf);
console.log("OK  avgIdf distingue bien une requete a terme rare d'une requete a terme courant");

// --- Aucun terme trouve -> score 0, jamais une erreur ---
const r3 = scoreWithIdf(["dinosaure", "mars"], corpus[0], df, N);
assert.strictEqual(r3.score, 0);
console.log("OK  aucune correspondance -> score 0, pas d'erreur");

console.log("\n=== TOUS LES TESTS OFFLINE LEXICAL-RARITY PASSENT ===");
