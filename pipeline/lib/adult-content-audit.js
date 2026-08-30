// pipeline/lib/adult-content-audit.js
// Classification de contenu adulte a PLUSIEURS signaux independants, pour
// eviter a la fois les faux negatifs (titre explicite non detecte) et les
// faux positifs (mot isole dans un long synopsis, ex: "Pornosec" dans 1984).
//
// Categories :
//   confirmed : signal FORT (titre explicite OU profil semantique explicite)
//               -> EXCLU de la recherche (hard constraint)
//   suspect   : signal FAIBLE UNIQUEMENT (texte Wikipedia brut, ancien
//               checkAdultContent) -> PAS exclu automatiquement, signale pour
//               revue manuelle (jamais transforme en "confirmed" sans preuve)
//   safe      : aucun signal
"use strict";

// Termes explicites de TITRE — un titre de film n'est (quasiment) jamais
// "accidentellement" explicite, contrairement a un mot isole dans un long
// synopsis. Liste a but de classification de securite, volontairement large
// sur ce champ precis (le titre), pas sur le texte libre.
const TITLE_EXPLICIT_TERMS = [
  /\banal\b/i, /\bxxx\b/i, /\bhardcore\b/i, /\bpornograph\w*/i, /\bmilf\b/i,
  /\bgangbang\b/i, /\borgy\b/i, /\bcumshot\w*/i, /\bejaculat\w*/i, /\bpussies\b/i,
  /\bpornstar\w*/i, /\bfellatio\b/i,
];

// Termes explicites dans le PROFIL SEMANTIQUE genere (themes/keywords/tone/moods)
// — signal independant et fort car le modele a deja lu le vrai synopsis pour
// produire ces tags, contrairement au texte Wikipedia brut qui peut contenir
// une mention incidente.
const SEMANTIC_EXPLICIT_TERMS = [
  /pornograph\w*/i, /\bporno\b/i, /sexuel.{0,15}explicite/i, /\bhardcore\b/i, /\bxxx\b/i,
];

function matchAny(haystack, patterns) {
  const matched = [];
  for (const re of patterns) { const m = haystack.match(re); if (m) matched.push(m[0]); }
  return matched;
}

function checkTitleSignal(title) {
  const matched = matchAny(title || "", TITLE_EXPLICIT_TERMS);
  return { flagged: matched.length > 0, matched: [...new Set(matched)] };
}

function checkSemanticSignal(profile) {
  if (!profile) return { flagged: false, matched: [] };
  const haystack = [...(profile.themes || []), ...(profile.keywords || []), ...(profile.tone || []), ...(profile.moods || [])].join(" ");
  const matched = matchAny(haystack, SEMANTIC_EXPLICIT_TERMS);
  return { flagged: matched.length > 0, matched: [...new Set(matched)] };
}

/**
 * Classifie un film. Ne modifie jamais le film. Renvoie {category, reasons}.
 * category : 'confirmed' | 'suspect' | 'safe'
 */
function classify(movie) {
  const titleSignal = checkTitleSignal(movie.title);
  const semanticSignal = checkSemanticSignal(movie.semantic_profile);
  const textSignal = movie.adult_content || { flagged: false, matched_terms: [] }; // ancien heuristique texte brut (faible, seul)

  const reasons = [];
  if (titleSignal.flagged) reasons.push(`titre contient : ${titleSignal.matched.join(", ")}`);
  if (semanticSignal.flagged) reasons.push(`profil semantique contient : ${semanticSignal.matched.join(", ")}`);
  if (textSignal.flagged) reasons.push(`texte Wikipedia contient (signal faible seul) : ${(textSignal.matched_terms || []).join(", ")}`);

  if (titleSignal.flagged || semanticSignal.flagged) return { category: "confirmed", reasons };
  if (textSignal.flagged) return { category: "suspect", reasons };
  return { category: "safe", reasons: [] };
}

/** Contrainte dure utilisee par le moteur de recherche : seuls les 'confirmed' sont exclus. */
function passesAdultContentFilter(movie) {
  return classify(movie).category !== "confirmed";
}

module.exports = { classify, passesAdultContentFilter, checkTitleSignal, checkSemanticSignal, TITLE_EXPLICIT_TERMS, SEMANTIC_EXPLICIT_TERMS };
