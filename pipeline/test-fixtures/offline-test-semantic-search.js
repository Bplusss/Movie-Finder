// pipeline/test-fixtures/offline-test-semantic-search.js
"use strict";
const assert = require("assert");
const { parseQuery, scoreFilm, runQuery } = require("../lib/semantic-search");

const films = [
  { title: "Comédie Légère", genres: ["comedy"], year: 2015, runtime_minutes: 95, countries: ["France"], actors: [],
    semantic_profile: { moods: ["leger", "drole"], humor: 8, intensity: 2, violence: 0, feel_good: 8, romance: 2, darkness: 1, action: 0, suspense: 1, emotional_intensity: 2, complexity: 1, pace: 5 } },
  { title: "Thriller Sombre", genres: ["thriller"], year: 2019, runtime_minutes: 130, countries: ["USA"], actors: ["Russell Crowe"],
    semantic_profile: { moods: ["sombre", "tendu"], humor: 1, intensity: 8, violence: 7, feel_good: 1, romance: 0, darkness: 8, action: 4, suspense: 9, emotional_intensity: 5, complexity: 6, pace: 7 } },
  { title: "Action Familiale", genres: ["action", "adventure"], year: 2012, runtime_minutes: 105, countries: ["USA"], actors: [],
    semantic_profile: { moods: ["aventureux"], humor: 4, intensity: 6, violence: 2, feel_good: 6, romance: 1, darkness: 1, action: 7, suspense: 4, emotional_intensity: 3, complexity: 2, pace: 7 } },
];

// --- parseQuery ---
const q1 = parseQuery("Je veux un film drôle et léger pour regarder ce soir");
assert(q1.genres.includes("comedy"));
assert(q1.moods.includes("leger"));
console.log("OK  parseQuery (drôle et léger)");

const q2 = parseQuery("Un film de moins de 2h avec Russell Crowe");
assert.strictEqual(q2.max_runtime, 120);
assert.strictEqual(q2.actor, "russell crowe");
console.log("OK  parseQuery (contrainte durée + acteur)");

// --- scoreFilm : contrainte dure de durée ---
const longFilm = { runtime_minutes: 160, genres: [], countries: [], actors: [], semantic_profile: {} };
assert.strictEqual(scoreFilm(longFilm, { max_runtime: 120, genres: [], moods: [] }), null, "un film trop long doit être exclu, pas juste pénalisé");
console.log("OK  scoreFilm exclut strictement un film trop long (contrainte dure)");

// --- runQuery : "drôle et léger" doit remonter la comédie en tête ---
const r1 = runQuery("Je veux un film drôle et léger", films);
assert.strictEqual(r1.top[0].film.title, "Comédie Légère");
console.log("OK  runQuery classe la comédie légère en premier pour une recherche 'drôle et léger'");

// --- runQuery : "thriller avec suspense" doit remonter le thriller sombre ---
const r2 = runQuery("Un thriller sombre avec beaucoup de suspense", films);
assert.strictEqual(r2.top[0].film.title, "Thriller Sombre");
console.log("OK  runQuery classe le thriller sombre en premier pour une recherche adaptée");

// --- runQuery : contrainte acteur exclut les films sans Russell Crowe ---
const r3 = runQuery("Un film avec Russell Crowe", films);
assert.strictEqual(r3.top.length, 1);
assert.strictEqual(r3.top[0].film.title, "Thriller Sombre");
console.log("OK  runQuery n'inclut que le film contenant Russell Crowe (contrainte dure respectée)");

// --- runQuery : chaque résultat a une raison explicable ---
r1.top.forEach(t => assert(t.result.reasons.length > 0, "chaque résultat doit avoir au moins une raison"));
console.log("OK  chaque résultat retourné a une justification (reasons)");

console.log("\n=== TOUS LES TESTS OFFLINE SEMANTIC-SEARCH PASSENT ===");
