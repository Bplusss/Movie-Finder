// pipeline/lib/benchmark-snapshot.js
// Scaffold MINIMAL pour comparer deux versions du moteur sur le meme jeu de
// requetes. Volontairement simple (pas de base de donnees, pas d'UI) —
// juste de quoi sauvegarder un resultat nomme et en comparer deux plus tard.
"use strict";
const fs = require("fs");
const path = require("path");

const SNAPSHOT_DIR = path.join(__dirname, "..", "test-results", "snapshots");

function ensureDir() { if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true }); }

/** Sauvegarde un resultat de benchmark sous un nom de version (ex: "V3.1", "V3.2"). */
function saveSnapshot(versionName, results) {
  ensureDir();
  const p = path.join(SNAPSHOT_DIR, `${versionName}.json`);
  fs.writeFileSync(p, JSON.stringify({ versionName, savedAt: new Date().toISOString(), results }, null, 2));
  return p;
}

function loadSnapshot(versionName) {
  const p = path.join(SNAPSHOT_DIR, `${versionName}.json`);
  if (!fs.existsSync(p)) throw new Error(`Aucun snapshot pour "${versionName}" — lance d'abord saveSnapshot.`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Compare deux snapshots deja sauvegardes. results attendu : {avgRelevance, tauxBasses, incorrectFilters, queries: {q: relevanceScore}}. */
function compareSnapshots(versionA, versionB) {
  const a = loadSnapshot(versionA).results;
  const b = loadSnapshot(versionB).results;

  const regressions = [];
  if (a.queries && b.queries) {
    for (const q in a.queries) {
      if (b.queries[q] != null && a.queries[q] != null && b.queries[q] < a.queries[q] - 0.5) regressions.push(q);
    }
  }

  return {
    versionA, versionB,
    avgRelevance: { before: a.avgRelevance ?? null, after: b.avgRelevance ?? null },
    tauxBasses: { before: a.tauxBasses ?? null, after: b.tauxBasses ?? null },
    incorrectFilters: { before: a.incorrectFilters ?? null, after: b.incorrectFilters ?? null },
    regressions,
  };
}

module.exports = { saveSnapshot, loadSnapshot, compareSnapshots, SNAPSHOT_DIR };
