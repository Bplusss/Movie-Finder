// pipeline/lib/entity-gazetteer.js
// Construit un dictionnaire FERME de noms (acteurs/realisateurs) A PARTIR
// DES DONNEES REELLES du catalogue — pas une liste fixe ecrite a la main.
// PURE (aucun reseau ici). Correspondance la PLUS LONGUE toujours prioritaire
// ("Russell Crowe" jamais coupe en juste "Russell").
"use strict";

/** Normalise un nom : minuscules, accents retires, espaces multiples aplaties, apostrophes uniformisees. */
function normalizeName(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Construit le dictionnaire acteurs/realisateurs a partir du catalogue REEL (facts.actors / facts.directors). */
function buildGazetteer(catalogMovies) {
  const actorNames = new Map(); // normalise -> nom d'affichage original
  const directorNames = new Map();
  for (const m of catalogMovies) {
    for (const a of (m.facts.actors || [])) actorNames.set(normalizeName(a), a);
    for (const d of (m.facts.directors || [])) directorNames.set(normalizeName(d), d);
  }
  return { actorNames, directorNames };
}

/**
 * Cherche la PLUS LONGUE correspondance d'un nom connu dans un texte deja
 * normalise, a partir d'une position donnee. Renvoie {displayName, endIndex}
 * ou null. Essaie d'abord les phrases les plus longues (jusqu'a 4 mots).
 */
function findLongestNameAt(normalizedText, startIndex, nameMap) {
  const words = normalizedText.slice(startIndex).split(" ");
  for (let len = Math.min(4, words.length); len >= 1; len--) {
    const candidate = words.slice(0, len).join(" ");
    if (nameMap.has(candidate)) {
      return { displayName: nameMap.get(candidate), matchedText: candidate, wordCount: len };
    }
  }
  return null;
}

module.exports = { normalizeName, buildGazetteer, findLongestNameAt };
