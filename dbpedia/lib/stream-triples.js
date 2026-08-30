// dbpedia/lib/stream-triples.js
// Lit un fichier .ttl.bz2 (ou .ttl non compressé) ligne par ligne, en flux
// (jamais chargé entièrement en mémoire), et appelle `onTriple` pour chaque
// ligne parsée avec succès. Nécessite : npm install unbzip2-stream
"use strict";
const fs = require("fs");
const readline = require("readline");
const { parseLine } = require("./ntriples");

async function streamTriples(filePath, onTriple, { onProgress } = {}) {
  let input = fs.createReadStream(filePath);
  if (filePath.endsWith(".bz2")) {
    const unbzip2Stream = require("unbzip2-stream");
    input = input.pipe(unbzip2Stream());
  }
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let lineCount = 0, parsedCount = 0;
  for await (const line of rl) {
    lineCount++;
    const triple = parseLine(line);
    if (triple) { parsedCount++; onTriple(triple); }
    if (onProgress && lineCount % 500000 === 0) onProgress(lineCount, parsedCount);
  }
  return { lineCount, parsedCount };
}

module.exports = { streamTriples };
