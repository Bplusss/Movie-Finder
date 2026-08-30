// pipeline/lib/movie-search-v3.js
// Architecture RETRIEVAL -> RANKING complete.
//
//   REQUETE -> parseStructuredQuery (filtres durs + reste semantique)
//           -> applyHardFilters (pool ELIGIBLE, deterministe, jamais un score)
//           -> classifyFamily (2 familles generiques : ambiance / sujet-narratif)
//           -> ranking (lexical IDF + embedding, poids FIXES par famille,
//              jamais regles au cas par cas), UNIQUEMENT sur le pool deja filtre
//
// Les contraintes dures ne rentrent JAMAIS dans le score — un film qui ne les
// respecte pas est absent du pool avant meme que le ranking ne commence.
"use strict";
const { parseStructuredQuery, normalizeQuery } = require("./structured-query-parser");
const { applyHardFilters } = require("./hard-filter-retrieval");
const { parseQuery: engineParseQuery } = require("./semantic-search-engine");
const { buildDocumentFrequency, scoreWithIdf } = require("./lexical-rarity");
const { queryTokens } = require("./synopsis-search");

// Lexique GENERIQUE de la famille "ambiance/emotion" (pas une regle par
// requete — une categorie documentee de mots, choisie une fois). Complete
// le detecteur de moods de l'ancien moteur (qui ne couvre que "mysterieux").
const AMBIANCE_LEXICON = [
  "peur", "effrayant", "effraie", "terrifiant", "angoiss", "oppress", "tendu", "tension",
  "pression", "stress", "malaise", "sombre", "glacant", "inquiet",
  "feel-good", "feelgood", "feel good", "leger", "joyeux", "triste", "melancolique",
  "chaleureux", "reconfortant", "mysterieux",
  "rire", "fait rire", "comique", "hilarant", "drole", "amusant", // ajoute suite au bug reel "qui fait rire" -> mal classe en subject_narrative
];

/**
 * Classe la requete semantique residuelle en 2 familles GENERIQUES.
 * Combine le lexique d'ambiance ci-dessus avec les signaux deja detectes par
 * le moteur existant (moods/min/max) — jamais une regle specifique a un mot.
 */
function classifyFamily(semanticQuery) {
  const normalized = normalizeQuery(semanticQuery);
  const hasAmbianceWord = AMBIANCE_LEXICON.some(w => normalized.includes(w));
  const engineParsed = engineParseQuery(semanticQuery);
  const hasEngineMoodSignal = engineParsed.moods.length > 0 || Object.keys(engineParsed.min).length > 0 || Object.keys(engineParsed.max).length > 0;
  return (hasAmbianceWord || hasEngineMoodSignal) ? "ambiance" : "subject_narrative";
}

// Poids FIXES par famille — deux familles, deux jeux de poids, jamais
// modifies requete par requete. D'apres les tests precedents : l'ambiance
// est mieux captee par l'embedding sur `intro` ; le sujet/l'intrigue est
// mieux capte par le lexical pondere IDF sur `synopsis`.
const FAMILY_WEIGHTS = {
  ambiance: { lexical: 0.35, embedding: 0.65, embeddingField: "intro" },
  subject_narrative: { lexical: 0.65, embedding: 0.35, embeddingField: "synopsis" },
};

/**
 * Recherche complete v3. embeddingLookup(field, wikidata_id)->vecteur|null,
 * queryEmbedFn(text)->Promise<vecteur>, cosineSimilarity(a,b)->nombre —
 * tous injectables, pour tester hors-ligne avec un mock ou brancher les
 * vraies dependances (aucun reseau dans ce module lui-meme).
 */
async function searchV3(catalog, gazetteer, queryText, { embeddingLookup, queryEmbedFn, cosineSimilarity, n = 10 } = {}) {
  const parsed = parseStructuredQuery(queryText, gazetteer);
  const pool = applyHardFilters(catalog, parsed.filters);

  if (!parsed.semantic_query) {
    return {
      filters: parsed.filters, semantic_query: "", family: "structured_only", pool_size: pool.length,
      ranked: pool.slice(0, n).map(m => ({ movie: m, total: null, detail: {} })),
    };
  }

  const family = classifyFamily(parsed.semantic_query);
  const weights = FAMILY_WEIGHTS[family];

  const qTokens = queryTokens(parsed.semantic_query);
  const withSynopsis = pool.filter(m => m.synopsisOnlyText);
  const df = buildDocumentFrequency(withSynopsis.map(m => m.synopsisOnlyText));
  const N = withSynopsis.length || 1;
  const lexicalMap = new Map();
  withSynopsis.forEach(m => {
    const r = scoreWithIdf(qTokens, m.synopsisOnlyText, df, N);
    if (r.score > 0) lexicalMap.set(m.wikidata_id, r.score);
  });

  const embeddingMap = new Map();
  if (embeddingLookup && queryEmbedFn && cosineSimilarity) {
    const qVec = await queryEmbedFn(parsed.semantic_query);
    for (const m of pool) {
      const vec = embeddingLookup(weights.embeddingField, m.wikidata_id);
      if (vec) embeddingMap.set(m.wikidata_id, Math.round(cosineSimilarity(qVec, vec) * 100));
    }
  }

  const ranked = pool.map(m => {
    const lex = lexicalMap.get(m.wikidata_id) || 0;
    const emb = embeddingMap.get(m.wikidata_id) || 0;
    const total = Math.round(lex * weights.lexical + emb * weights.embedding);
    return { movie: m, total, detail: { lexical: lex, embedding: emb, family, embeddingField: weights.embeddingField } };
  }).sort((a, b) => b.total - a.total);

  return { filters: parsed.filters, semantic_query: parsed.semantic_query, family, pool_size: pool.length, ranked: ranked.slice(0, n) };
}

module.exports = { searchV3, classifyFamily, FAMILY_WEIGHTS, AMBIANCE_LEXICON };
