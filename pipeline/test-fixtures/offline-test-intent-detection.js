// pipeline/test-fixtures/offline-test-intent-detection.js
"use strict";
const assert = require("assert");
const { detectIntent, computeWeights } = require("../lib/intent-detection");

const noStructured = { required: { genres: [] }, moods: [], min: {}, max: {} };
const withGenre = { required: { genres: ["thriller"] }, moods: [], min: {}, max: {} };
const withMood = { required: { genres: [] }, moods: [], min: { humor: 6 }, max: {} };

const cat1 = detectIntent(noStructured, 1.5);
assert(cat1.includes("sujet_precis_entite"), "un IDF eleve doit declencher la categorie sujet precis/entite");
console.log("OK  IDF eleve (terme rare type 'vietnam') -> categorie sujet_precis_entite detectee");

const weights1 = computeWeights(cat1);
assert(weights1.lexical > weights1.embedding, "le lexical doit peser plus que l'embedding sur un sujet precis");
assert(weights1.lexical > weights1.structured, "le lexical doit dominer sur un sujet precis");
console.log(`OK  poids sur sujet precis : lexical=${weights1.lexical} > embedding=${weights1.embedding} (regle fondamentale respectee)`);

const cat2 = detectIntent(withMood, 0.1);
assert(cat2.includes("ambiance_emotion"));
assert(!cat2.includes("sujet_precis_entite"), "un IDF bas ne doit pas declencher sujet_precis_entite");
const weights2 = computeWeights(cat2);
assert(weights2.embedding > weights2.lexical, "sur une requete d'ambiance, l'embedding doit dominer le lexical");
console.log(`OK  poids sur ambiance/emotion : embedding=${weights2.embedding} > lexical=${weights2.lexical}`);

const cat3 = detectIntent(withGenre, 0.1);
assert(cat3.includes("genre"));
const weights3 = computeWeights(cat3);
assert(weights3.structured > weights3.lexical && weights3.structured > weights3.embedding, "sur un genre demande, structure doit dominer");
console.log(`OK  poids sur genre : structured=${weights3.structured} domine les autres`);

const cat4 = detectIntent(noStructured, 0);
assert.deepStrictEqual(cat4, ["situation_narrative"]);
console.log("OK  aucun signal detecte -> categorie par defaut 'situation_narrative' (jamais vide)");

const cat5 = detectIntent(withGenre, 1.5);
assert(cat5.includes("combinaison"));
console.log("OK  plusieurs categories detectees -> 'combinaison' ajoutee");

[weights1, weights2, weights3].forEach(w => {
  const sum = w.structured + w.lexical + w.intro + w.embedding;
  assert(Math.abs(sum - 1) < 1e-9, `les poids doivent sommer a 1, obtenu ${sum}`);
});
console.log("OK  les poids somment toujours exactement a 1");

console.log("\n=== TOUS LES TESTS OFFLINE INTENT-DETECTION PASSENT ===");
