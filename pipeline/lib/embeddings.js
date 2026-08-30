// pipeline/lib/embeddings.js
// Embeddings LOCAUX (bibliotheque @xenova/transformers, JS pur, aucun
// service externe, PAS Ollama). Modele multilingue FR/EN adapte a la
// similarite semantique de phrases.
"use strict";

const MODEL_NAME = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
let embedderPromise = null;

/** Charge le modele une seule fois (lazy). Premiere execution = telechargement (~120-130 Mo), puis mis en cache par la bibliotheque elle-meme. */
async function getEmbedder() {
  if (!embedderPromise) {
    const { pipeline } = await import("@xenova/transformers");
    embedderPromise = pipeline("feature-extraction", MODEL_NAME, { quantized: true });
  }
  return embedderPromise;
}

/** Renvoie le vecteur d'embedding (tableau de nombres) d'un texte. */
async function embed(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/** Similarite cosinus entre deux vecteurs — PURE, aucun reseau, testable hors-ligne. */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0; // jamais de division par zero
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { MODEL_NAME, getEmbedder, embed, cosineSimilarity };
