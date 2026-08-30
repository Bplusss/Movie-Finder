// pipeline/test-fixtures/offline-test-ablation-variants.js
"use strict";
const assert = require("assert");
const { VARIANTS, applyVariant } = require("../lib/ablation-variants");

const baseline = VARIANTS.baseline;
function countDiffs(a, b) {
  let n = 0;
  if (a.raritySrategy !== b.raritySrategy) n++;
  if (a.threshold !== b.threshold) n++;
  if (a.ambianceEmbeddingField !== b.ambianceEmbeddingField) n++;
  if (JSON.stringify(a.extraGenreWords) !== JSON.stringify(b.extraGenreWords)) n++;
  return n;
}
for (const name in VARIANTS) {
  if (name === "baseline" || name === "combined_best_guess") continue;
  assert.strictEqual(countDiffs(baseline, VARIANTS[name]), 1, `la variante '${name}' doit differer de baseline sur EXACTEMENT un parametre (ablation)`);
}
console.log("OK  chaque variante isole exactement UN SEUL parametre par rapport a baseline");

const pool = [
  { wikidata_id: "Q1", title: "Vrai Film de Guerre", facts: { genres: ["war"] } },
  { wikidata_id: "Q2", title: "Comedie Sans Rapport", facts: { genres: ["comedy"] } },
];
const queryContext = {
  queryTextLower: "je veux un film de guerre",
  parsedStructured: { required: { genres: [] }, moods: [], min: {}, max: {} },
  bestMatchedTerms: ["film", "guerre"],
  dfSynopsis: new Map([["film", 100], ["guerre", 95]]),
  N: 100,
  pool,
  embeddingMaps: {
    synopsis: new Map([["Q1", 40], ["Q2", 20]]),
    intro: new Map([["Q1", 70], ["Q2", 10]]),
    combined: new Map([["Q1", 50], ["Q2", 15]]),
  },
  lexicalSynopsisMap: new Map([["Q1", 90], ["Q2", 10]]),
  structuredScoreFn: () => 0,
};

const rBaseline = applyVariant(baseline, queryContext);

const rExtraGenre = applyVariant(VARIANTS.extra_genre_words, queryContext);
assert(rExtraGenre.categories.includes("genre"), "avec extra_genre_words seul, 'guerre' doit etre reconnu comme genre");
assert(!rBaseline.categories.includes("genre"), "la baseline ne doit PAS reconnaitre 'guerre' comme genre (c'est precisement le defaut identifie)");
console.log("OK  la variante 'extra_genre_words', ISOLEE, change bien la categorie detectee (effet attribuable a ce seul changement)");

const rEmbeddingIntro = applyVariant(VARIANTS.ambiance_embedding_intro, queryContext);
assert.strictEqual(rEmbeddingIntro.embeddingField, "synopsis", "sans categorie ambiance_emotion, le champ embedding doit rester synopsis (variante sans effet ICI, comme attendu)");
console.log("OK  la variante 'ambiance_embedding_intro' n'a (a raison) aucun effet sur un scenario sans ambiance detectee — isolation confirmee");

const ambianceContext = { ...queryContext, parsedStructured: { required: { genres: [] }, moods: ["peur"], min: {}, max: {} } };
const rAmbianceBaseline = applyVariant(baseline, ambianceContext);
const rAmbianceIntro = applyVariant(VARIANTS.ambiance_embedding_intro, ambianceContext);
assert.strictEqual(rAmbianceBaseline.embeddingField, "synopsis");
assert.strictEqual(rAmbianceIntro.embeddingField, "intro");
assert.notDeepStrictEqual(rAmbianceBaseline.ranked, rAmbianceIntro.ranked, "le classement doit changer quand le champ embedding change (Q1 a 70 sur intro vs 40 sur synopsis)");
console.log("OK  sur un scenario d'ambiance, la variante 'ambiance_embedding_intro' change bien le classement — effet isole et attribuable");

console.log("\n=== TOUS LES TESTS OFFLINE ABLATION-VARIANTS PASSENT ===");
