// dbpedia/lib/ntriples.js
// Parseur N-Triples minimal et pragmatique (pas une implémentation complète
// de la spec RDF — juste ce qu'il faut pour les fichiers DBpedia Databus,
// qui sont toujours au format `<sujet> <prédicat> objet .` par ligne).
// PURE : aucun accès réseau/fichier ici, testable hors-ligne.
"use strict";

/**
 * Parse une ligne N-Triples. Renvoie null pour les lignes vides/commentaires
 * ou mal formées (on ignore, on ne fait jamais planter tout le flux pour une
 * ligne corrompue — cohérent avec le reste du pipeline).
 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  // Sujet : toujours une URI entre < >
  const subjectMatch = trimmed.match(/^<([^>]+)>\s+/);
  if (!subjectMatch) return null;
  let rest = trimmed.slice(subjectMatch[0].length);

  // Prédicat : toujours une URI entre < >
  const predicateMatch = rest.match(/^<([^>]+)>\s+/);
  if (!predicateMatch) return null;
  rest = rest.slice(predicateMatch[0].length);

  // Objet : soit une URI <...>, soit une chaîne "..."@lang ou "...".
  rest = rest.replace(/\s*\.\s*$/, ""); // retire le point final

  let object = null, lang = null, isLiteral = false;
  if (rest.startsWith("<")) {
    const m = rest.match(/^<([^>]+)>/);
    if (m) object = m[1];
  } else if (rest.startsWith('"')) {
    // Chaîne littérale, potentiellement avec échappements \" et \\
    const m = rest.match(/^"((?:[^"\\]|\\.)*)"(@([a-zA-Z-]+))?/);
    if (m) {
      object = m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
      lang = m[3] || null;
      isLiteral = true;
    }
  }
  if (object === null) return null;

  return { subject: subjectMatch[1], predicate: predicateMatch[1], object, lang, isLiteral };
}

module.exports = { parseLine };
