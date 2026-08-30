// pipeline/test-fixtures/offline-test-select-representative.js
"use strict";
const assert = require("assert");
const { selectRepresentative } = require("../lib/select-representative");

const films = [
  { wikidata_id: "Q1", title: "Vieux Film", year: 1942, genres: ["romance"] },
  { wikidata_id: "Q2", title: "Comédie", year: 2015, genres: ["comedy"] },
  { wikidata_id: "Q3", title: "Thriller", year: 2019, genres: ["thriller"] },
  { wikidata_id: "Q4", title: "Action", year: 2012, genres: ["action"] },
  { wikidata_id: "Q5", title: "Film Récent", year: 2023, genres: ["drama"] },
  { wikidata_id: "Q6", title: "SF", year: 2010, genres: ["scifi"] },
];

const selected = selectRepresentative(films, 5);
assert.strictEqual(selected.length, 5);
const ids = selected.map(f => f.wikidata_id);
assert.strictEqual(new Set(ids).size, 5, "aucun doublon");
assert(ids.includes("Q1"), "le plus ancien doit être inclus");
assert(ids.includes("Q5"), "le plus récent doit être inclus");
console.log("OK  selectRepresentative inclut le plus ancien et le plus récent, sans doublon");

// --- Diversité de genre : comédie et thriller doivent être représentés si demandé assez large ---
const selected2 = selectRepresentative(films, 6);
const genresSelected = selected2.flatMap(f => f.genres);
assert(genresSelected.includes("comedy"));
assert(genresSelected.includes("thriller"));
console.log("OK  selectRepresentative couvre plusieurs genres différents");

// --- Ne plante jamais si count > nombre de films disponibles ---
const selected3 = selectRepresentative(films, 50);
assert.strictEqual(selected3.length, films.length);
console.log("OK  ne plante pas si count dépasse le nombre de films disponibles");

console.log("\n=== TOUS LES TESTS OFFLINE SELECT-REPRESENTATIVE PASSENT ===");
