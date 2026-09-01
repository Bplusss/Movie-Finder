// pipeline/test-fixtures/offline-test-compare-json-vs-supabase.js
"use strict";
const assert = require("assert");
const { buildGazetteer } = require("../lib/entity-gazetteer");
const { searchV3 } = require("../lib/movie-search-v3");
const { resultSignature, compareSignatures } = require("../compare-json-vs-supabase");

const catalog = [
  { wikidata_id: "Q1", title: "Mystic River", facts: { year: 2003, runtime_minutes: 138, genres: ["thriller"], directors: ["Clint Eastwood"], actors: ["Sean Penn"] }, synopsisOnlyText: "un homme se venge", introText: "" },
  { wikidata_id: "Q2", title: "Invictus", facts: { year: 2009, runtime_minutes: 134, genres: ["drama"], directors: ["Clint Eastwood"], actors: ["Morgan Freeman"] }, synopsisOnlyText: "rugby afrique du sud", introText: "" },
];
const gazetteer = buildGazetteer(catalog);

(async () => {
  const r1 = await searchV3(catalog, gazetteer, "un film realise par Clint Eastwood", {});
  const r2 = await searchV3(catalog, gazetteer, "un film realise par Clint Eastwood", {});
  const sig1 = resultSignature(r1), sig2 = resultSignature(r2);
  assert.deepStrictEqual(compareSignatures(sig1, sig2), [], "deux catalogues identiques doivent produire ZERO divergence");
  console.log("OK  catalogues identiques -> 0 divergence detectee");

  const catalogMissingFilm = [catalog[0]];
  const gazetteerMissing = buildGazetteer(catalogMissingFilm);
  const r3 = await searchV3(catalogMissingFilm, gazetteerMissing, "un film realise par Clint Eastwood", {});
  const sig3 = resultSignature(r3);
  const diffs = compareSignatures(sig1, sig3);
  assert(diffs.length > 0, "un film manquant DOIT etre detecte comme une divergence");
  assert(diffs.some(d => d.includes("pool") || d.includes("IDs")), "la divergence doit mentionner le pool ou les IDs concernes");
  console.log("OK  film manquant d'un cote -> divergence correctement detectee et decrite");

  console.log("\n=== TOUS LES TESTS OFFLINE COMPARE-JSON-VS-SUPABASE PASSENT ===");
})();
