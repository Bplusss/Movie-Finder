// pipeline/lib/lexical-rarity.js
// Logique PURE (aucun reseau ici) : pondere les mots-cles par leur RARETE
// REELLE dans le corpus (IDF classique), pas par un poids arbitraire choisi
// a la main. Un mot rare (ex: "vietnam") pese naturellement plus qu'un mot
// courant (ex: "guerre") s'il est effectivement plus rare dans les 980
// synopsis — mesure, pas suppose.
"use strict";
const { tokenize } = require("./synopsis-search");

/** Construit df[token] = nombre de textes du corpus contenant ce token (au moins une fois). */
function buildDocumentFrequency(texts) {
  const df = new Map();
  for (const text of texts) {
    const uniqueTokens = new Set(tokenize(text));
    for (const t of uniqueTokens) df.set(t, (df.get(t) || 0) + 1);
  }
  return df;
}

/** IDF classique : log(N / (1+df)). Un token absent du corpus recoit l'IDF maximal (le plus rare possible). */
function idf(token, df, N) {
  const count = df.get(token) || 0;
  return Math.log(N / (1 + count));
}

/**
 * Score un texte pour une liste de mots-cles de requete deja tokenises,
 * pondere par IDF. Renvoie aussi l'IDF moyen des termes REELLEMENT trouves —
 * c'est ce signal qui sert a detecter une requete "sujet precis" (IDF eleve)
 * vs une requete "mots courants" (IDF bas).
 */
function scoreWithIdf(queryTokens, text, df, N) {
  const textTokens = new Set(tokenize(text));
  const matched = queryTokens.filter(t => textTokens.has(t));
  if (!matched.length) return { score: 0, matchedTerms: [], avgIdf: 0 };

  const idfs = matched.map(t => idf(t, df, N));
  const maxPossibleIdf = queryTokens.reduce((a, t) => a + idf(t, df, N), 0);
  const achievedIdf = idfs.reduce((a, v) => a + v, 0);
  const score = maxPossibleIdf > 0 ? Math.round((achievedIdf / maxPossibleIdf) * 100) : 0;
  const avgIdf = idfs.reduce((a, v) => a + v, 0) / idfs.length;

  return { score, matchedTerms: [...new Set(matched)], avgIdf };
}

module.exports = { buildDocumentFrequency, idf, scoreWithIdf };
