// pipeline/lib/adult-content-check.js
// Mecanisme de detection HEURISTIQUE de contenu pornographique/sexuellement
// explicite, base uniquement sur le texte deja en notre possession (titre +
// introduction/synopsis Wikipedia). PURE (aucun reseau ici).
//
// LIMITE IMPORTANTE, A NE PAS OUBLIER :
// Ceci est un FILET DE SECURITE, PAS UNE GARANTIE. Un film peut ne
// mentionner aucun de ces termes dans son titre/synopsis Wikipedia tout en
// etant un film pour adultes (synopsis pudique, euphemismes...). Inversement,
// un film mainstream PEUT mentionner un de ces mots dans un contexte non
// pornographique (ex. un documentaire SUR l'industrie). Ce mecanisme doit
// etre traite comme une premiere passe a verifier manuellement, pas comme un
// filtre parfait. Une verification croisee avec les categories Wikidata
// (non faite ici, necessiterait un nouvel acces reseau) ameliorerait la fiabilite.
"use strict";

// Termes de classification standard (pas de jargon d'acces/echange), en
// francais et en anglais, utilises par les catalogues et bases de donnees de
// films pour designer explicitement ce genre.
const ADULT_KEYWORDS = [
  /\bpornograph\w*/i,
  /\bhardcore\b/i,
  /\bX-rated\b/i,
  /\bfilm[s]? X\b/i,
  /\badult film\b/i,
  /\bfilm pornographique\b/i,
];

/** Verifie le titre + le texte disponible. Renvoie {flagged, matched_terms}. */
function checkAdultContent(title, text) {
  const haystack = `${title || ""} ${text || ""}`;
  const matched = [];
  for (const re of ADULT_KEYWORDS) {
    const m = haystack.match(re);
    if (m) matched.push(m[0]);
  }
  return { flagged: matched.length > 0, matched_terms: [...new Set(matched)] };
}

module.exports = { checkAdultContent, ADULT_KEYWORDS };
