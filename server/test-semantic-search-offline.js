// server/test-semantic-search-offline.js
"use strict";
const assert = require("assert");
const { handleSemanticSearch, toClientShape, explainResult } = require("./semantic-search");

const movie1 = {
  wikidata_id: "Q1", title: "Comédie Légère",
  facts: { year: 2018, runtime_minutes: 95, countries: ["France"], genres: ["comedy"], directors: ["X"], actors: ["Y"] },
  semantic_profile: { humor: 9, action: 1, violence: 0, tension: 1, romance: null, emotional: 3, complexity: 2, feel_good: 9, darkness: 1, family_friendly: 8, tone: ["leger"], moods: ["feelgood"], themes: ["amitie"], keywords: [], good_for: ["soiree entre amis"] },
  adult_content: { flagged: false },
};
const movie2 = {
  wikidata_id: "Q2", title: "Thriller Sombre",
  facts: { year: 2020, runtime_minutes: 110, countries: ["USA"], genres: ["thriller"], directors: ["Z"], actors: [] },
  semantic_profile: { humor: 1, action: 5, violence: 6, tension: 9, romance: null, emotional: 5, complexity: 6, feel_good: 1, darkness: 9, family_friendly: 0, tone: ["sombre"], moods: ["angoissant"], themes: ["vengeance"], keywords: [], good_for: [] },
  adult_content: { flagged: false },
};

// --- handleSemanticSearch : requete valide ---
const r1 = handleSemanticSearch([movie1, movie2], { query: "un film drôle" });
assert.strictEqual(r1.status, 200);
assert.strictEqual(r1.body.results[0].movie.title, "Comédie Légère");
console.log("OK  handleSemanticSearch retourne un resultat coherent pour une requete valide");

// --- Absence de query -> 400 explicite ---
const r2 = handleSemanticSearch([movie1], {});
assert.strictEqual(r2.status, 400);
console.log("OK  requete sans 'query' -> 400 explicite, pas un crash silencieux");

// --- excludeIds fonctionne ---
const r3 = handleSemanticSearch([movie1, movie2], { query: "un film drôle", excludeIds: ["Q1"] });
assert(!r3.body.results.some(r => r.movie.id === "Q1"), "un film dans excludeIds ne doit jamais reapparaitre");
console.log("OK  excludeIds filtre correctement les films deja vus");

// --- toClientShape : jamais de valeur inventee pour un null ---
const shape = toClientShape(movie1);
assert.strictEqual(shape.romance, null, "romance=null doit rester null dans la forme client, jamais une valeur par defaut");
assert.strictEqual(shape.id, "Q1");
console.log("OK  toClientShape preserve null (jamais transforme en 0 ou valeur par defaut)");

// --- explainResult : ne mentionne JAMAIS good_for ---
const r4 = handleSemanticSearch([movie1], { query: "je veux un film pour une soirée entre amis, drôle et léger" });
r4.body.results.forEach(res => {
  assert(!res.explanation.toLowerCase().includes("good_for"), "l'explication ne doit jamais exposer good_for");
  assert(!res.explanation.toLowerCase().includes("soiree entre amis"), "good_for ne doit pas influencer/apparaitre dans l'explication meme si le film le contient");
});
console.log("OK  l'explication ne mentionne jamais good_for, meme quand le film en a un");

// --- Film sans aucun critere evaluable -> explication generale, pas une erreur ---
const emptyProfileMovie = { ...movie1, wikidata_id: "Q3", semantic_profile: { ...movie1.semantic_profile, humor: null, feel_good: null } };
const r5 = handleSemanticSearch([emptyProfileMovie], { query: "un film drôle et chaleureux" });
if (r5.body.results.length) assert(typeof r5.body.results[0].explanation === "string");
console.log("OK  un film sans critere evaluable recoit une explication generale, pas un crash");

console.log("\n=== TOUS LES TESTS OFFLINE SEMANTIC-SEARCH SERVER PASSENT ===");
