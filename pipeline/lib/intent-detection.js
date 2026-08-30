// pipeline/lib/intent-detection.js
// Logique PURE (aucun reseau ici) : detecte le TYPE d'intention d'une
// requete a partir de signaux MESURES (IDF des termes trouves, presence de
// criteres structurels), et propose des poids de fusion en consequence.
// Les poids ne sont PAS un tableau fixe applique aveuglement — ils
// decoulent de ce qui a ete reellement detecte pour CETTE requete precise.
"use strict";

// Seuil au-dela duquel un terme trouve est considere "rare/precis" (sujet,
// entite nommee). Choisi car un IDF de 0 signifie "present dans la moitie ou
// plus du corpus" (aucun pouvoir discriminant) ; un IDF > 1 signifie
// "present dans moins d'un tiers du corpus environ" — un vrai signal de
// specificite. Documente ici, pas invente au hasard.
const RARE_TERM_IDF_THRESHOLD = 1.0;

/**
 * Determine les categories d'intention presentes dans une requete.
 * parsedStructured = resultat de parseQuery() du moteur principal (inchange).
 * bestLexicalAvgIdf = avgIdf du meilleur resultat lexical sur synopsis.
 */
function detectIntent(parsedStructured, bestLexicalAvgIdf) {
  const categories = [];

  if (parsedStructured.required.genres.length) categories.push("genre");
  const hasMoodOrBounds = parsedStructured.moods.length > 0
    || Object.keys(parsedStructured.min).length > 0
    || Object.keys(parsedStructured.max).length > 0;
  if (hasMoodOrBounds) categories.push("ambiance_emotion");
  if (bestLexicalAvgIdf >= RARE_TERM_IDF_THRESHOLD) categories.push("sujet_precis_entite");

  if (categories.length === 0) categories.push("situation_narrative"); // rien de reconnu par les autres detecteurs -> traite comme une situation a chercher dans le recit
  if (categories.length > 1) categories.push("combinaison");

  return categories;
}

/**
 * Propose des poids de fusion {structured, lexical, intro, embedding} —
 * somme = 1. Regle fondamentale respectee : si "sujet_precis_entite" est
 * detecte, le lexical (sur synopsis) domine toujours largement — un
 * embedding ne doit jamais pouvoir l'ecraser.
 */
function computeWeights(categories) {
  if (categories.includes("sujet_precis_entite")) {
    return { structured: 0.15, lexical: 0.60, intro: 0.05, embedding: 0.20 };
  }
  if (categories.includes("ambiance_emotion")) {
    return { structured: 0.30, lexical: 0.15, intro: 0.05, embedding: 0.50 };
  }
  if (categories.includes("genre")) {
    return { structured: 0.50, lexical: 0.20, intro: 0.05, embedding: 0.25 };
  }
  // situation narrative generique : ni entite rare, ni genre, ni ambiance detectee
  return { structured: 0.10, lexical: 0.40, intro: 0.10, embedding: 0.40 };
}

module.exports = { detectIntent, computeWeights, RARE_TERM_IDF_THRESHOLD };
