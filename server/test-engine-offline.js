// server/test-engine-offline.js
"use strict";
const assert = require("assert");
const engine = require("./engine");

const candidates = [
  { id: "u1", title: "Comédie Courte FR", year: 2015, runtime_minutes: 95, countries: ["France"], genres: ["comedy"], moods: ["funny", "light"], actors: [], violence: 1, intensity: 2, complexity: 1, humor: 8, action: 0, romance: 1, feel_good: 8, directors: [], good_for: ["friends"], tags: [] },
  { id: "u2", title: "Thriller Long", year: 2015, runtime_minutes: 160, countries: ["USA"], genres: ["thriller"], moods: ["dark"], actors: ["Russell Crowe"], violence: 8, intensity: 9, complexity: 6, humor: 0, action: 3, romance: 0, feel_good: 0, directors: [], good_for: ["evening"], tags: [] },
  { id: "u3", title: "Comédie FR mais longue", year: 2015, runtime_minutes: 150, countries: ["France"], genres: ["comedy"], moods: ["funny"], actors: [], violence: 0, intensity: 2, complexity: 1, humor: 7, action: 0, romance: 1, feel_good: 7, directors: [], good_for: ["friends"], tags: [] },
];
const statsByMovieId = new Map(); // aucune note encore -> stats neutres par défaut

// Test 1 : contrainte dure de durée -> le film de 150/160min doit être exclu
const parsed1 = { genres: ["comedy"], countries: ["France"], max_runtime: 120 };
const res1 = engine.recommend({ candidates, statsByMovieId, profileRows: [], excludeIds: new Set(), watchedIds: new Set(), parsed: parsed1, n: 3 });
assert(res1.every(r => r.movie.runtime <= 120), "aucun résultat ne doit dépasser 120min");
assert(res1.some(r => r.movie.id === "u1"), "u1 (95min, comédie FR) doit être recommandé");
assert(!res1.some(r => r.movie.id === "u3"), "u3 (150min) doit être exclu malgré son genre correspondant");
console.log("OK  contrainte dure de durée respectée");

// Test 2 : contrainte dure d'acteur
const parsed2 = { actors: ["russell crowe"] };
const res2 = engine.recommend({ candidates, statsByMovieId, profileRows: [], excludeIds: new Set(), watchedIds: new Set(), parsed: parsed2, n: 3 });
assert.strictEqual(res2.length, 1, "un seul film contient Russell Crowe dans ce jeu de données");
assert.strictEqual(res2[0].movie.id, "u2");
console.log("OK  contrainte dure d'acteur respectée");

// Test 3 : watchedIds exclut bien un film déjà vu
const res3 = engine.recommend({ candidates, statsByMovieId, profileRows: [], excludeIds: new Set(), watchedIds: new Set(["u1"]), parsed: { genres: ["comedy"] }, n: 3 });
assert(!res3.some(r => r.movie.id === "u1"), "u1 déjà vu ne doit jamais être recommandé");
console.log("OK  exclusion des films déjà vus");

console.log("\n=== TOUS LES TESTS OFFLINE DU MOTEUR SERVEUR PASSENT ===");
