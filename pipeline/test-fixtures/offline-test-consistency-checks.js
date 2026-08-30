// pipeline/test-fixtures/offline-test-consistency-checks.js
"use strict";
const assert = require("assert");
const { checkConsistency } = require("../lib/consistency-checks");

// --- Cas reel exact trouve dans l'audit : "Crack: Cocaine, Corruption & Conspiracy" ---
const crackProfile = { family_friendly: 3, good_for: ["en couple", "en famille"], darkness: 8, feel_good: 2, violence: null, humor: null };
const w1 = checkConsistency(crackProfile);
assert(w1.some(w => w.includes("family_friendly") && w.includes("famille")), "doit detecter le cas reel trouve dans l'audit");
console.log("OK  detecte le cas réel exact de l'audit (family_friendly bas + good_for 'famille')");

// --- Profil sain, sans contradiction -> aucun warning ---
const healthyProfile = { family_friendly: 9, good_for: ["en famille"], darkness: 1, feel_good: 8, violence: 1, humor: 6 };
const w2 = checkConsistency(healthyProfile);
assert.deepStrictEqual(w2, [], "un profil cohérent ne doit générer aucun warning");
console.log("OK  aucun faux positif sur un profil cohérent");

// --- darkness + feel_good tous les deux eleves -> warning ---
const contradictory = { family_friendly: null, good_for: [], darkness: 8, feel_good: 8, violence: null, humor: null };
const w3 = checkConsistency(contradictory);
assert(w3.some(w => w.includes("darkness") && w.includes("feel_good")));
console.log("OK  detecte darkness et feel_good simultanément élevés");

// --- violence + family_friendly tous les deux eleves -> warning ---
const violentFamily = { family_friendly: 8, good_for: [], darkness: null, feel_good: null, violence: 8, humor: null };
const w4 = checkConsistency(violentFamily);
assert(w4.some(w => w.includes("violence") && w.includes("family_friendly")));
console.log("OK  detecte violence et family_friendly simultanément élevés");

// --- null ne doit JAMAIS déclencher un faux warning (pas de comparaison sur une valeur absente) ---
const allNull = { family_friendly: null, good_for: [], darkness: null, feel_good: null, violence: null, humor: null };
assert.deepStrictEqual(checkConsistency(allNull), []);
console.log("OK  des scores null ne déclenchent jamais de faux warning");

// --- Ne modifie JAMAIS le profil passé en entrée (uniquement des warnings, jamais de correction) ---
const original = { ...crackProfile };
checkConsistency(crackProfile);
assert.deepStrictEqual(crackProfile, original, "checkConsistency ne doit JAMAIS modifier le profil");
console.log("OK  checkConsistency ne modifie jamais le profil (signale uniquement)");

console.log("\n=== TOUS LES TESTS OFFLINE CONSISTENCY-CHECKS PASSENT ===");
