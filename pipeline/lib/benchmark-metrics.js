// pipeline/lib/benchmark-metrics.js
// Metriques d'evaluation de classement, PURES (aucun reseau ici). Prennent
// en entree une liste ordonnee de titres et un ground truth manuel
// {relevant: [...], acceptable: [...]}, jamais l'inverse — le ground truth
// n'est jamais devine automatiquement, toujours fourni par un humain.
"use strict";

function isRelevant(title, groundTruth) {
  return (groundTruth.relevant || []).includes(title);
}
function isAcceptable(title, groundTruth) {
  return isRelevant(title, groundTruth) || (groundTruth.acceptable || []).includes(title);
}

/** Precision@k : proportion de resultats pertinents (relevant OU acceptable) parmi les k premiers. */
function precisionAtK(rankedTitles, groundTruth, k) {
  const top = rankedTitles.slice(0, k);
  if (!top.length) return 0;
  const hits = top.filter(t => isAcceptable(t, groundTruth)).length;
  return hits / top.length;
}

/** Recall@k : proportion des pertinents CONNUS (relevant uniquement) retrouves dans les k premiers. */
function recallAtK(rankedTitles, groundTruth, k) {
  const relevantSet = groundTruth.relevant || [];
  if (!relevantSet.length) return null; // ground truth insuffisant pour cette mesure, ne jamais deviner
  const top = new Set(rankedTitles.slice(0, k));
  const found = relevantSet.filter(t => top.has(t)).length;
  return found / relevantSet.length;
}

/** MRR (un seul resultat) : 1/rang du premier resultat pertinent trouve, 0 si absent. */
function reciprocalRank(rankedTitles, groundTruth) {
  for (let i = 0; i < rankedTitles.length; i++) {
    if (isRelevant(rankedTitles[i], groundTruth)) return 1 / (i + 1);
  }
  return 0;
}

/** NDCG@k simplifie : pertinence graduee (relevant=2, acceptable=1, sinon 0), gain actualise log2. */
function ndcgAtK(rankedTitles, groundTruth, k) {
  const grade = t => isRelevant(t, groundTruth) ? 2 : (isAcceptable(t, groundTruth) ? 1 : 0);
  const top = rankedTitles.slice(0, k);
  const dcg = top.reduce((sum, t, i) => sum + grade(t) / Math.log2(i + 2), 0);
  const idealGrades = [
    ...(groundTruth.relevant || []).map(() => 2),
    ...(groundTruth.acceptable || []).map(() => 1),
  ].sort((a, b) => b - a).slice(0, k);
  const idcg = idealGrades.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);
  return idcg > 0 ? dcg / idcg : 0;
}

/** Calcule toutes les metriques pour un resultat de classement donne. */
function evaluate(rankedTitles, groundTruth) {
  return {
    precisionAt5: precisionAtK(rankedTitles, groundTruth, 5),
    precisionAt10: precisionAtK(rankedTitles, groundTruth, 10),
    recallAt10: recallAtK(rankedTitles, groundTruth, 10),
    mrr: reciprocalRank(rankedTitles, groundTruth),
    ndcgAt10: ndcgAtK(rankedTitles, groundTruth, 10),
  };
}

module.exports = { precisionAtK, recallAtK, reciprocalRank, ndcgAtK, evaluate, isRelevant, isAcceptable };
