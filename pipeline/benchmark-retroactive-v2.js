#!/usr/bin/env node
// pipeline/benchmark-retroactive-v2.js
// npm run benchmark:retroactive
//
// Applique les metriques de pipeline/lib/benchmark-metrics.js AUX VRAIS
// RESULTATS DEJA OBTENUS lors du run reel sur les 1018 films (colles depuis
// la conversation, verbatim, jamais modifies). Le ground truth ci-dessous
// est un JUGEMENT MANUEL DE L'ASSISTANT sur la pertinence de chaque titre —
// PAS une verite absolue, a corriger par l'utilisateur qui connait mieux
// les films et peut voir les synopsis complets. Aucun reseau necessaire,
// tourne instantanement sur des donnees deja observees.
"use strict";
const { evaluate } = require("./lib/benchmark-metrics");

const OBSERVED = {
  "je veux un film de guerre": [
    "Barb Wire", "Chaque bâtard est un roi", "Master and Commander : De l'autre côté du monde",
    "La Liste de Schindler", "La Bande à Baader", "Blood Diamond", "Imitation Game",
    "Sayonara", "L'Étoffe des héros", "Le Frère 2",
  ],
  "je veux un film qui fait peur": [
    "E.T., l'extra-terrestre", "Le train sifflera trois fois", "Donnie Darko",
    "Once Upon a Time in... Hollywood", "Copains pour toujours", "Quantum of Solace",
    "Le Choc des Titans", "Comme des bêtes 2", "Parle avec elle", "Imitation Game",
  ],
  "un film qui se déroule pendant la guerre du Vietnam": [
    "Apocalypse Now", "JFK", "Good Morning, Vietnam", "Ali", "Top Gun",
    "La Mélodie du bonheur", "In the Loop", "Qu'elle était verte ma vallée",
    "Le Cabinet du docteur Caligari", "Assurance sur la mort",
  ],
  "un film sur un braquage": [
    "O'Brother", "Sexy Beast", "Heat", "Hors d'atteinte", "Point Break",
    "Les Minions 2 : Il était une fois Gru", "Thelma et Louise", "Taxi",
    "Qu'elle était verte ma vallée", "Barry Lyndon",
  ],
  "un film où quelqu'un doit retrouver son enfant": [
    "Parle avec elle", "Blade Runner 2049", "Mulholland Drive", "Seven", "The Big Lebowski",
    "Léon", "Sonic 2, le film", "Oliver !", "127 Heures", "Harry Potter et la Chambre des secrets",
  ],
  "un film qui me fera vraiment peur": [
    "Le train sifflera trois fois", "E.T., l'extra-terrestre", "Imitation Game", "Quantum of Solace",
    "Le Choc des Titans", "Comme des bêtes 2", "Donnie Darko", "Once Upon a Time in... Hollywood",
    "Parle avec elle", "Copains pour toujours",
  ],
  "quelque chose qui me mette la pression": [
    "Twilight, chapitre II : Tentation", "Silverado", "Cœur de dragon",
    "Le Tour du monde en quatre-vingts jours", "Erin Brockovich, seule contre tous", "Head-On",
    "La Vérité si je mens ! 3", "Big", "Le Cercle des poètes disparus", "L'Aventure intérieure",
  ],
  "un film sur des soldats américains au Vietnam": [
    "Good Morning, Vietnam", "JFK", "Top Gun", "La Chute du faucon noir", "Apocalypse Now",
    "Miss Karaté Kid", "Transformers 3: La Face cachée de la Lune", "G.I. Joe : Le Réveil du Cobra",
    "Ali", "Sayonara",
  ],
  "un film de braquage qui tourne mal": [
    "Huit et demi", "Blade 2", "La Chute du faucon noir", "L'Aventure intérieure", "Heat",
    "Les Minions 2 : Il était une fois Gru", "Star Trek : Générations", "Le Cinquième Élément",
    "Good Bye, Lenin!", "Les Incorruptibles",
  ],
  "un film avec une histoire de vengeance": [
    "X-Men Origins: Wolverine", "Princess Bride", "Carrie : La Vengeance", "Crying Freeman",
    "Blade 2", "Twilight, chapitre I : Fascination", "Saw 3", "Stand by Me", "The Lone Ranger",
    "La Famille Addams",
  ],
  "un film qui se passe dans l'espace": [
    "L'Étoffe des héros", "127 Heures", "Spy Kids 3 : Mission 3D", "The Rocky Horror Picture Show",
    "Donnie Darko", "Solaris", "Avengers: Endgame", "X-Men: Dark Phoenix", "Star Trek", "Avatar",
  ],
};

// GROUND TRUTH — jugement manuel de l'assistant. A CORRIGER par l'utilisateur.
const GROUND_TRUTH = {
  "je veux un film de guerre": {
    relevant: ["Master and Commander : De l'autre côté du monde", "La Liste de Schindler", "Blood Diamond"],
    acceptable: ["Imitation Game", "Chaque bâtard est un roi", "Sayonara"],
  },
  "je veux un film qui fait peur": { relevant: [], acceptable: ["Donnie Darko"] },
  "un film qui se déroule pendant la guerre du Vietnam": {
    relevant: ["Apocalypse Now", "Good Morning, Vietnam"], acceptable: ["JFK", "Ali"],
  },
  "un film sur un braquage": {
    relevant: ["Heat", "Point Break", "Sexy Beast", "Hors d'atteinte"],
    acceptable: ["O'Brother", "Thelma et Louise", "Les Minions 2 : Il était une fois Gru"],
  },
  "un film où quelqu'un doit retrouver son enfant": {
    relevant: [], acceptable: ["Blade Runner 2049", "Oliver !"],
  },
  "un film qui me fera vraiment peur": { relevant: [], acceptable: ["Donnie Darko"] },
  "quelque chose qui me mette la pression": {
    relevant: [], acceptable: ["Erin Brockovich, seule contre tous", "Head-On"],
  },
  "un film sur des soldats américains au Vietnam": {
    relevant: ["Good Morning, Vietnam", "Apocalypse Now"], acceptable: ["JFK", "Ali", "Sayonara"],
  },
  "un film de braquage qui tourne mal": {
    relevant: ["Heat"], acceptable: ["Les Incorruptibles", "Les Minions 2 : Il était une fois Gru"],
  },
  "un film avec une histoire de vengeance": {
    relevant: ["X-Men Origins: Wolverine", "Princess Bride", "Carrie : La Vengeance", "Saw 3", "The Lone Ranger"],
    acceptable: ["Crying Freeman"],
  },
  "un film qui se passe dans l'espace": {
    relevant: ["Solaris", "Star Trek", "Avatar"],
    acceptable: ["Avengers: Endgame", "X-Men: Dark Phoenix", "Spy Kids 3 : Mission 3D", "L'Étoffe des héros"],
  },
};

function run() {
  console.log("=== BENCHMARK RETROACTIF — strategie HYBRIDE actuelle, sur les vrais resultats du 29/08 ===");
  console.log("(Ground truth = jugement manuel de l'assistant, A VALIDER/CORRIGER par l'utilisateur)\n");

  const rows = [];
  for (const query in GROUND_TRUTH) {
    const ranked = OBSERVED[query];
    if (!ranked) continue;
    const metrics = evaluate(ranked, GROUND_TRUTH[query]);
    rows.push({ query, ...metrics });
    console.log(`"${query}"`);
    console.log(`  P@5=${metrics.precisionAt5.toFixed(2)}  P@10=${metrics.precisionAt10.toFixed(2)}  MRR=${metrics.mrr.toFixed(2)}  NDCG@10=${metrics.ndcgAt10.toFixed(2)}`);
  }

  const avg = key => rows.reduce((a, r) => a + r[key], 0) / rows.length;
  console.log(`\n=== MOYENNES SUR ${rows.length} REQUETES (hors "tension progressive", ground truth non defini) ===`);
  console.log(`P@5 moyen    : ${avg("precisionAt5").toFixed(2)}`);
  console.log(`P@10 moyen   : ${avg("precisionAt10").toFixed(2)}`);
  console.log(`MRR moyen    : ${avg("mrr").toFixed(2)}`);
  console.log(`NDCG@10 moyen: ${avg("ndcgAt10").toFixed(2)}`);

  console.log(`\nRequetes avec MRR=0 (aucun resultat relevant du tout dans le top 10) :`);
  rows.filter(r => r.mrr === 0).forEach(r => console.log(`  - "${r.query}"`));
}

if (require.main === module) run();
module.exports = { OBSERVED, GROUND_TRUTH, run };
