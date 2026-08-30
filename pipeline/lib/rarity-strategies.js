// pipeline/lib/rarity-strategies.js
// Plusieurs strategies de mesure "ce mot est-il un concept precis de
// recherche" — PAS uniquement l'IDF moyen (strategie A, celle qui a cause
// le bug "mette"). Toutes PURES, testables sans reseau.
"use strict";
const { idf } = require("./lexical-rarity");

// Liste fermee de mots grammaticaux frequemment rares statistiquement mais
// jamais des concepts de recherche : verbes tres courants a la 3e personne/
// infinitif, particules. Cette liste est un FILTRE EXPLICITE, pas une
// pretention a la lemmatisation complete (qui necessiterait une bibliotheque
// de NLP francais — cout/benefice discute en reponse, non implemente ici).
const GRAMMATICAL_BLOCKLIST = new Set([
  "mette", "mettre", "met", "mets", "mise",
  "tourne", "tourner", "tournee",
  "mal", "bien", "tres", "plus", "moins", "meme", "aussi", "encore",
  "fait", "faire", "fais", "fera", "ferai",
  "doit", "devoir", "doivent",
  "monte", "monter", "montee",
  "passe", "passer", "passee",
  "donne", "donner",
]);

/** Strategie A (deja en place) : moyenne simple des IDF des termes trouves. */
function strategyA_average(matchedTokens, df, N) {
  if (!matchedTokens.length) return 0;
  return matchedTokens.reduce((a, t) => a + idf(t, df, N), 0) / matchedTokens.length;
}

/** Strategie B : maximum des IDF — un seul terme tres rare suffit a signaler un sujet precis, sans etre dilue par des mots courants voisins. */
function strategyB_max(matchedTokens, df, N) {
  if (!matchedTokens.length) return 0;
  return Math.max(...matchedTokens.map(t => idf(t, df, N)));
}

/** Strategie C : moyenne des N mots les plus rares uniquement (ignore les mots courants melanges dans la meme requete). */
function strategyC_topNAverage(matchedTokens, df, N, topN = 2) {
  if (!matchedTokens.length) return 0;
  const sorted = matchedTokens.map(t => idf(t, df, N)).sort((a, b) => b - a);
  const top = sorted.slice(0, topN);
  return top.reduce((a, v) => a + v, 0) / top.length;
}

/** Strategie D : IDF filtre — retire d'abord les mots grammaticaux connus (liste explicite ci-dessus), puis moyenne. Corrige directement le bug "mette". */
function strategyD_filteredAverage(matchedTokens, df, N) {
  const filtered = matchedTokens.filter(t => !GRAMMATICAL_BLOCKLIST.has(t));
  if (!filtered.length) return 0; // tous les mots trouves etaient grammaticaux -> aucun signal de precision
  return filtered.reduce((a, t) => a + idf(t, df, N), 0) / filtered.length;
}

module.exports = {
  strategyA_average, strategyB_max, strategyC_topNAverage, strategyD_filteredAverage,
  GRAMMATICAL_BLOCKLIST,
};
