// pipeline/lib/synopsis-search.js
// Recherche de contenu LEGERE (aucun Ollama, aucun embedding) : mesure la
// proximite entre une requete et le texte d'un synopsis par recouvrement de
// mots-cles. Objectif POC uniquement : voir si le texte apporte un signal la
// ou le moteur structure actuel ne comprend rien (aucun critere detecte).
"use strict";

const STOPWORDS = new Set([
  "le","la","les","un","une","des","de","du","et","qui","que","dans","sur","avec","pour",
  "au","aux","se","son","sa","ses","est","il","elle","ce","cette","ces","je","veux","d","l",
  "vraiment","quelque","chose","me","mon","ma","mes","fait","fera","où","ou",
]);

function tokenize(text) {
  if (!text) return [];
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return (normalized.match(/[a-z0-9]+/g) || []);
}

function queryTokens(text) {
  return tokenize(text).filter(t => !STOPWORDS.has(t) && t.length > 2);
}

/** Score de recouvrement simple : proportion des mots-cles de la requete retrouves dans le texte. */
function scoreSynopsisMatch(qTokens, text) {
  const textTokens = new Set(tokenize(text));
  if (!textTokens.size || !qTokens.length) return { score: 0, matchedTerms: [] };
  const matched = qTokens.filter(t => textTokens.has(t));
  return { score: matched.length / qTokens.length, matchedTerms: [...new Set(matched)] };
}

/** catalog attend des objets {..., synopsisText: string} deja fusionnes (voir build-hybrid-catalog.js). */
function searchBySynopsis(catalog, text, { n = 10 } = {}) {
  const qTokens = queryTokens(text);
  const scored = catalog
    .map(m => {
      const r = scoreSynopsisMatch(qTokens, m.synopsisText);
      return { movie: m, score: Math.round(r.score * 100), matchedTerms: r.matchedTerms };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return { queryTokens: qTokens, top: scored.slice(0, n) };
}

module.exports = { tokenize, queryTokens, scoreSynopsisMatch, searchBySynopsis };
