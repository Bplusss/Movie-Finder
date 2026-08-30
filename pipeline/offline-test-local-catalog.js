// pipeline/test-fixtures/offline-test-local-catalog.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { loadCatalog } = require("../lib/local-catalog");

const tmpFile = path.join(os.tmpdir(), `catalog-test-${Date.now()}.json`);

const fixture = [
  { wikidata_id: "Q1", title: "Film A", facts: { genres: ["comedy"] }, semantic_status: "success",
    semantic_profile: { humor: 8, action: null, violence: null, tension: null, romance: null, emotional: null, complexity: null, feel_good: 8, darkness: null, family_friendly: null, tone: ["leger"], moods: [], themes: [], keywords: [], good_for: [] },
    adult_content: { flagged: false } },
  { wikidata_id: "Q2", title: "Film B (doublon)", facts: { genres: [] }, semantic_status: "success", semantic_profile: null, adult_content: { flagged: false } },
  { wikidata_id: "Q2", title: "Film B bis (meme wikidata_id)", facts: { genres: [] }, semantic_status: "success", semantic_profile: null, adult_content: { flagged: false } },
  { wikidata_id: "Q3", title: "Film C (profil invalide)", facts: { genres: [] }, semantic_status: "success",
    semantic_profile: { humor: 15, action: null, violence: null, tension: null, romance: null, emotional: null, complexity: null, feel_good: null, darkness: null, family_friendly: null, tone: null, moods: null, themes: null, keywords: null, good_for: null },
    adult_content: { flagged: false } },
];
fs.writeFileSync(tmpFile, JSON.stringify(fixture));

const { movies, stats } = loadCatalog(tmpFile);
assert.strictEqual(stats.total, 4);
assert.strictEqual(stats.duplicateCount, 1, "Q2 apparait deux fois -> 1 doublon detecte");
assert.strictEqual(stats.invalidProfileCount, 1, "humor=15 est hors bornes -> 1 profil invalide detecte");
assert.strictEqual(movies.find(m => m.wikidata_id === "Q3")._profileInvalid, true, "le film au profil invalide est marque, pas supprime");
assert.strictEqual(movies.length, 4, "aucun film n'est retire du catalogue, meme invalide/doublon");

fs.unlinkSync(tmpFile);
console.log("OK  loadCatalog detecte les doublons et les profils invalides sans rien supprimer");
console.log("\n=== TOUS LES TESTS OFFLINE LOCAL-CATALOG PASSENT ===");
