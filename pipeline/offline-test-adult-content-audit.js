// pipeline/test-fixtures/offline-test-adult-content-audit.js
"use strict";
const assert = require("assert");
const { classify, passesAdultContentFilter } = require("../lib/adult-content-audit");

// --- CAS REEL RAPPORTE : faux negatif (le modele avait pourtant deja detecte le vrai contenu) ---
const littleAnalLovers = {
  title: "Little Anal Lovers",
  semantic_profile: { themes: ["comique", "sexuel"], keywords: ["pornographie", "comédie"], tone: ["leger"], moods: [] },
  adult_content: { flagged: false, matched_terms: [] }, // l'ancien heuristique texte l'avait manque
};
const c1 = classify(littleAnalLovers);
assert.strictEqual(c1.category, "confirmed", "titre explicite -> confirmed, meme si l'ancien texte-heuristique l'avait manque");
assert.strictEqual(passesAdultContentFilter(littleAnalLovers), false, "doit etre exclu de la recherche");
console.log("OK  cas réel 'Little Anal Lovers' -> confirmed via signal titre (faux négatif corrigé)");

const explicitTitleCase = {
  title: "Pussies Being Filled With Huge Loads! Right Before Ejaculation!",
  semantic_profile: { themes: ["porno"], keywords: ["porno", "sexisme", "exploitation"], tone: ["sombre"], moods: ["sordide"] },
};
const c2 = classify(explicitTitleCase);
assert.strictEqual(c2.category, "confirmed");
console.log("OK  cas réel avec titre + profil sémantique tous deux explicites -> confirmed (double signal)");

// --- CAS REEL RAPPORTE : faux positifs a corriger (mot isole dans un long synopsis, PAS un vrai film adulte) ---
const film1984 = {
  title: "1984",
  semantic_profile: { themes: ["dystopie", "totalitarisme", "surveillance"], keywords: ["big brother", "novlangue", "resistance"], tone: ["sombre"], moods: ["angoissant"] },
  adult_content: { flagged: true, matched_terms: ["pornographic"] }, // l'ancien heuristique texte avait matche un mot incident (ex: le "Pornosec" du roman)
};
const c3 = classify(film1984);
assert.strictEqual(c3.category, "suspect", "un mot isole dans le synopsis, sans corroboration titre/profil, ne doit PAS devenir confirmed");
assert.strictEqual(passesAdultContentFilter(film1984), true, "1984 ne doit PAS etre exclu de la recherche (faux positif corrige)");
console.log("OK  cas réel '1984' (faux positif) -> suspect seulement, PAS exclu (titre et profil sémantique sont normaux)");

const deadpool2 = {
  title: "Deadpool 2",
  semantic_profile: { themes: ["super-heros", "humour noir", "action"], keywords: ["mercenaire", "x-force"], tone: ["comique"], moods: ["epique"] },
  adult_content: { flagged: true, matched_terms: ["hardcore"] },
};
const c4 = classify(deadpool2);
assert.strictEqual(c4.category, "suspect");
assert.strictEqual(passesAdultContentFilter(deadpool2), true, "Deadpool 2 doit rester chargeable dans les resultats");
console.log("OK  cas réel 'Deadpool 2' (faux positif) -> suspect seulement, PAS exclu");

// --- Film normal, aucun signal ---
const filmSafe = { title: "Le Fabuleux Destin d'Amélie Poulain", semantic_profile: { themes: ["amour", "paris"], keywords: [], tone: ["leger"], moods: ["feelgood"] } };
assert.strictEqual(classify(filmSafe).category, "safe");
console.log("OK  un film ordinaire sans aucun signal -> safe");

// --- Ne modifie jamais le film passe en entree ---
const original = JSON.parse(JSON.stringify(littleAnalLovers));
classify(littleAnalLovers);
assert.deepStrictEqual(littleAnalLovers, original, "classify ne doit jamais modifier le film");
console.log("OK  classify ne modifie jamais le film (signale uniquement)");

console.log("\n=== TOUS LES TESTS OFFLINE ADULT-CONTENT-AUDIT PASSENT ===");
