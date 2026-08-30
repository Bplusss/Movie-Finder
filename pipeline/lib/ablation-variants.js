// pipeline/lib/ablation-variants.js
// Cadre d'ABLATION : chaque variante ne change QU'UN SEUL parametre par
// rapport a la baseline, pour isoler precisement l'effet de chaque
// changement candidat. PURE (aucun reseau, aucun calcul d'embedding ici —
// prend en entree des scores DEJA calcules). Ne touche jamais au moteur de
// production (semantic-search-engine.js, intent-detection.js) : cette
// logique de categorisation est une COPIE LOCALE parametrable, distincte de
// la production, exactement pour permettre l'ablation sans y toucher.
"use strict";
const { strategyA_average, strategyB_max, strategyC_topNAverage, strategyD_filteredAverage } = require("./rarity-strategies");

const RARITY_STRATEGY_FNS = {
  A: (tokens, df, N) => strategyA_average(tokens, df, N),
  B: (tokens, df, N) => strategyB_max(tokens, df, N),
  C: (tokens, df, N) => strategyC_topNAverage(tokens, df, N, 2),
  D: (tokens, df, N) => strategyD_filteredAverage(tokens, df, N),
};

/** Copie LOCALE de la categorisation, parametrable en seuil — ne modifie jamais intent-detection.js (production). */
function categorize(parsedStructured, raritySignal, threshold) {
  const categories = [];
  if (parsedStructured.required.genres.length) categories.push("genre");
  const hasMoodOrBounds = parsedStructured.moods.length > 0
    || Object.keys(parsedStructured.min).length > 0
    || Object.keys(parsedStructured.max).length > 0;
  if (hasMoodOrBounds) categories.push("ambiance_emotion");
  if (raritySignal >= threshold) categories.push("sujet_precis_entite");
  if (categories.length === 0) categories.push("situation_narrative");
  if (categories.length > 1) categories.push("combinaison");
  return categories;
}

function weightsFor(categories) {
  if (categories.includes("sujet_precis_entite")) return { structured: 0.15, lexical: 0.60, embedding: 0.20 };
  if (categories.includes("ambiance_emotion")) return { structured: 0.30, lexical: 0.15, embedding: 0.50 };
  if (categories.includes("genre")) return { structured: 0.50, lexical: 0.20, embedding: 0.25 };
  return { structured: 0.10, lexical: 0.40, embedding: 0.40 };
}

// Chaque variante ne change QU'UNE chose par rapport a BASELINE. C'est le
// point central de l'ablation : jamais deux changements a la fois, sauf la
// variante "combinee" explicitement nommee comme telle, ajoutee a la fin
// pour comparaison seulement APRES avoir vu chaque effet isole.
const VARIANTS = {
  baseline: { raritySrategy: "A", threshold: 1.0, ambianceEmbeddingField: "synopsis", extraGenreWords: {} },
  rarity_B: { raritySrategy: "B", threshold: 1.0, ambianceEmbeddingField: "synopsis", extraGenreWords: {} },
  rarity_C: { raritySrategy: "C", threshold: 1.0, ambianceEmbeddingField: "synopsis", extraGenreWords: {} },
  rarity_D: { raritySrategy: "D", threshold: 1.0, ambianceEmbeddingField: "synopsis", extraGenreWords: {} },
  threshold_2_5: { raritySrategy: "A", threshold: 2.5, ambianceEmbeddingField: "synopsis", extraGenreWords: {} },
  ambiance_embedding_intro: { raritySrategy: "A", threshold: 1.0, ambianceEmbeddingField: "intro", extraGenreWords: {} },
  extra_genre_words: { raritySrategy: "A", threshold: 1.0, ambianceEmbeddingField: "synopsis", extraGenreWords: { guerre: "war" } },
  combined_best_guess: { raritySrategy: "D", threshold: 2.5, ambianceEmbeddingField: "intro", extraGenreWords: { guerre: "war" } },
};

/**
 * Applique UNE variante a UNE requete deja preparee (queryContext = donnees
 * DEJA calculees une seule fois, partagees par toutes les variantes — voir
 * benchmark-ablation.js). Renvoie le classement + le detail de routage, pour
 * comprendre PRECISEMENT pourquoi une variante change (ou non) le resultat.
 */
function applyVariant(variant, queryContext) {
  let parsed = queryContext.parsedStructured;
  // Simulation LOCALE des mots de genre supplementaires (n'ecrit jamais dans le moteur de production)
  if (Object.keys(variant.extraGenreWords).length) {
    const extraGenres = [];
    for (const word in variant.extraGenreWords) {
      if (queryContext.queryTextLower.includes(word) && !parsed.required.genres.includes(variant.extraGenreWords[word])) {
        extraGenres.push(variant.extraGenreWords[word]);
      }
    }
    if (extraGenres.length) parsed = { ...parsed, required: { genres: [...parsed.required.genres, ...extraGenres] } };
  }

  const raritySignal = RARITY_STRATEGY_FNS[variant.raritySrategy](queryContext.bestMatchedTerms, queryContext.dfSynopsis, queryContext.N);
  const categories = categorize(parsed, raritySignal, variant.threshold);
  const weights = weightsFor(categories);

  const useAmbianceEmbedding = categories.includes("ambiance_emotion");
  const embeddingField = useAmbianceEmbedding ? variant.ambianceEmbeddingField : "synopsis";
  const embMap = queryContext.embeddingMaps[embeddingField] || new Map();

  let pool = queryContext.pool;
  if (parsed.required.genres.length) pool = pool.filter(m => parsed.required.genres.some(g => (m.facts.genres || []).includes(g)));

  const ranked = pool.map(m => {
    const structScore = queryContext.structuredScoreFn(m, parsed);
    const lexScore = queryContext.lexicalSynopsisMap.get(m.wikidata_id) || 0;
    const embScore = embMap.get(m.wikidata_id) || 0;
    const total = Math.round(structScore * weights.structured + lexScore * weights.lexical + embScore * weights.embedding);
    return { wikidata_id: m.wikidata_id, title: m.title, total };
  }).sort((a, b) => b.total - a.total);

  return { categories, weights, embeddingField, raritySignal, ranked };
}

module.exports = { VARIANTS, RARITY_STRATEGY_FNS, categorize, weightsFor, applyVariant };
