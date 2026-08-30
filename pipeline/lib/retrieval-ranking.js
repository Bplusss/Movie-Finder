// pipeline/lib/retrieval-ranking.js
// Architecture RETRIEVAL -> RANKING, distincte de la simple somme ponderee
// actuelle. Etape 1 (retrieval) : UNION des candidats trouves par N'IMPORTE
// QUELLE source (lexical synopsis, lexical intro, embedding synopsis,
// embedding intro) — un film n'est jamais elimine tot parce qu'UN SEUL
// signal l'a manque. Etape 2 (ranking) : seuls les candidats retenus sont
// notes finement. PURE, testable sans reseau (prend des scores deja
// calcules en entree, ne recalcule rien).
"use strict";

/**
 * Union des candidats. Chaque `sourceResults` est un tableau [{wikidata_id, score}, ...]
 * deja trie par une source. topKPerSource permet de garder tout candidat qui
 * apparait dans AU MOINS UNE des sources parmi son topK, meme si son score
 * final combine est bas — evite qu'un bon film disparaisse simplement parce
 * qu'une seule source (ex: l'embedding) l'a mal classe.
 */
function unionCandidates(sourceResultsList, topKPerSource = 30) {
  const candidateIds = new Set();
  for (const sourceResults of sourceResultsList) {
    sourceResults.slice(0, topKPerSource).forEach(r => candidateIds.add(r.wikidata_id));
  }
  return candidateIds;
}

/**
 * Etape ranking : reçoit l'ensemble des candidats retenus + une table de
 * scores par source (Map wikidata_id -> score 0-100 par source) + les poids.
 * Renvoie le classement final, avec le detail par source pour justification.
 */
function rankCandidates(candidateIds, scoreMaps, weights) {
  const results = [];
  for (const id of candidateIds) {
    let total = 0;
    const detail = {};
    for (const source in weights) {
      const score = (scoreMaps[source] && scoreMaps[source].get(id)) || 0;
      detail[source] = score;
      total += score * weights[source];
    }
    results.push({ wikidata_id: id, total: Math.round(total), detail });
  }
  return results.sort((a, b) => b.total - a.total);
}

module.exports = { unionCandidates, rankCandidates };
