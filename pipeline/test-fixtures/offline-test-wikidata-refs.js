// pipeline/test-fixtures/offline-test-wikidata-refs.js
"use strict";
const assert = require("assert");
const { computeRefStatus, buildInitialUnresolvedRefs, applyResolution, collectPendingIds } = require("../lib/wikidata-refs");

// --- computeRefStatus ---
assert.strictEqual(computeRefStatus({ genres: ["Q1"], directors: ["Q2"], countries: ["Q3"], actors: ["Q4"] }), "fetched");
assert.strictEqual(computeRefStatus({ genres: [], directors: ["Q2"], countries: ["Q3"], actors: ["Q4"] }), "enriched");
assert.strictEqual(computeRefStatus({ genres: [], directors: [], countries: [], actors: [] }), "complete");
assert.strictEqual(computeRefStatus({}), "complete", "aucune clé du tout = rien en attente = complet");
console.log("OK  computeRefStatus (fetched/enriched/complete)");

// --- buildInitialUnresolvedRefs ---
const raw = { genre_refs: ["Q1"], director_refs: [], country_refs: ["Q3"], cast_refs: ["Q4", "Q5"] };
const initial = buildInitialUnresolvedRefs(raw);
assert.deepStrictEqual(initial, { genres: ["Q1"], directors: [], countries: ["Q3"], actors: ["Q4", "Q5"] });
console.log("OK  buildInitialUnresolvedRefs (une catégorie vide dès le départ = absente, pas bloquante)");
assert.strictEqual(computeRefStatus(initial), "enriched", "directors déjà réglé (absent) -> enriched dès l'insertion");

// --- applyResolution : résolution réussie ---
const movie1 = {
  genres: [], directors: [], countries: [], actors: [],
  unresolved_refs: { genres: ["Q157443"], directors: ["Q313039"], countries: [], actors: ["Q102711"] },
  unresolvable_refs: {},
};
const cache1 = new Map([
  ["Q157443", { label: "comedy film", attempts: 0, resolved: true }],
  ["Q313039", { label: "Jean-Pierre Jeunet", attempts: 0, resolved: true }],
  // Q102711 pas encore dans le cache -> doit rester en attente
]);
const result1 = applyResolution(movie1, cache1);
assert(result1, "un changement doit être détecté");
assert.deepStrictEqual(result1.genres, ["comedy"], "le libellé brut Wikidata doit être ramené au vocabulaire interne");
assert.deepStrictEqual(result1.directors, ["Jean-Pierre Jeunet"]);
assert.deepStrictEqual(result1.unresolved_refs.actors, ["Q102711"], "acteur non encore en cache -> reste en attente");
assert.strictEqual(result1.wikidata_ref_status, "enriched", "genres+directors+countries réglés, actors encore en attente");
console.log("OK  applyResolution (résolution partielle -> enriched, rien perdu pour ce qui reste en attente)");

// --- applyResolution : abandon après 3 tentatives (ne bloque jamais indéfiniment) ---
const movie2 = {
  genres: [], directors: [], countries: [], actors: [],
  unresolved_refs: { genres: ["Q_INTROUVABLE"], directors: [], countries: [], actors: [] },
  unresolvable_refs: {},
};
const cache2 = new Map([["Q_INTROUVABLE", { label: null, attempts: 3, resolved: false }]]);
const result2 = applyResolution(movie2, cache2);
assert.deepStrictEqual(result2.unresolved_refs.genres, [], "abandonné -> retiré des en-attente");
assert.deepStrictEqual(result2.unresolvable_refs.genres, ["Q_INTROUVABLE"], "tracé dans unresolvable pour audit");
assert.strictEqual(result2.wikidata_ref_status, "complete", "toutes les catégories réglées (dont une par abandon) -> complete");
console.log("OK  applyResolution (abandon après 3 tentatives -> réglé, jamais bloqué indéfiniment)");

// --- applyResolution : rien de nouveau dans le cache -> pas de changement ---
const movie3 = {
  genres: [], directors: [], countries: [], actors: [],
  unresolved_refs: { genres: ["Q999"], directors: [], countries: [], actors: [] },
  unresolvable_refs: {},
};
const result3 = applyResolution(movie3, new Map()); // cache vide
assert.strictEqual(result3, null, "aucun changement -> null, pour éviter une écriture inutile en base");
console.log("OK  applyResolution renvoie null quand rien n'a changé");

// --- applyResolution : genre résolu mais hors vocabulaire connu -> réglé quand même ---
const movie4 = {
  genres: [], directors: [], countries: [], actors: [],
  unresolved_refs: { genres: ["Q_GENRE_INCONNU"], directors: [], countries: [], actors: [] },
  unresolvable_refs: {},
};
const cache4 = new Map([["Q_GENRE_INCONNU", { label: "buddy film obscur", attempts: 0, resolved: true }]]);
const result4 = applyResolution(movie4, cache4);
assert.deepStrictEqual(result4.genres, [], "pas ajouté au vocabulaire, mais...");
assert.deepStrictEqual(result4.unresolved_refs.genres, [], "...bien retiré des en-attente (résolu, juste non reconnu)");
assert.strictEqual(result4.wikidata_ref_status, "complete");
console.log("OK  genre résolu hors vocabulaire connu -> réglé sans bloquer, sans pollution");

// --- collectPendingIds ---
const movie1After = { unresolved_refs: result1.unresolved_refs };
const pending = collectPendingIds([movie1After, movie3]);
assert.deepStrictEqual(pending.sort(), ["Q102711", "Q999"].sort());
console.log("OK  collectPendingIds (dédoublonné entre plusieurs films)");

console.log("\n=== TOUS LES TESTS OFFLINE WIKIDATA-REFS PASSENT ===");
