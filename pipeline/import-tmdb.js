#!/usr/bin/env node
// pipeline/import-tmdb.js
//
// npm run db:import
//
// Étape 1 : télécharge le fichier d'export quotidien TMDB (liste de TOUS les
//           films avec juste id + popularité) — un fichier, pas de requête
//           répétée à un endpoint fragile.
// Étape 2 : garde les CATALOG_TARGET films les plus populaires, puis récupère
//           le détail de chacun en 1 seul appel API (append_to_response),
//           avec reprise sur erreur et checkpoint.
//
// Prérequis :
//   export DATABASE_URL=postgresql://...
//   export TMDB_API_KEY=...   (clé API v3, gratuite sur themoviedb.org)
//   node pipeline/import-tmdb.js
//
// Variables optionnelles :
//   CATALOG_TARGET=1000   (nombre de films visés, par défaut 1000 — "commencer petit")
"use strict";
require("dotenv").config();
const path = require("path");
const zlib = require("zlib");
const { mapTmdbMovieToRow, isUsable, parseExportLine } = require("./lib/tmdb");
const { readCheckpoint, writeCheckpoint } = require("./lib/checkpoint");
const db = require("./lib/db");

const CHECKPOINT_PATH = path.join(__dirname, ".checkpoint-tmdb.json");
const TARGET_COUNT = parseInt(process.env.CATALOG_TARGET || "1000", 10);
const DELAY_MS = 250; // ~4 requêtes/seconde, volontairement prudent

function exportUrlForDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `http://files.tmdb.org/p/exports/movie_ids_${mm}_${dd}_${yyyy}.json.gz`;
}

/** Le fichier du jour n'est parfois publié qu'en fin de journée -> on retente hier. */
async function downloadDailyExport() {
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  for (const d of [today, yesterday]) {
    const url = exportUrlForDate(d);
    try {
      console.log(`Téléchargement de l'export TMDB du jour : ${url}`);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      const jsonLines = zlib.gunzipSync(buf).toString("utf8");
      return jsonLines;
    } catch (e) {
      console.warn(`Échec pour ${url} : ${e.message}`);
    }
  }
  throw new Error("Impossible de récupérer l'export TMDB (aujourd'hui ni hier).");
}

async function fetchMovieDetails(tmdbId, apiKey) {
  const url = `https://api.themoviedb.org/3/movie/${tmdbId}` +
    `?api_key=${apiKey}&language=fr-FR&append_to_response=credits,external_ids`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`TMDB HTTP ${resp.status}`);
  return resp.json();
}

async function run() {
  if (!process.env.TMDB_API_KEY) {
    throw new Error("TMDB_API_KEY manquant — crée une clé gratuite sur themoviedb.org (Paramètres > API) puis export TMDB_API_KEY=...");
  }
  if (!db.isConfigured()) {
    throw new Error("DATABASE_URL manquant.");
  }
  const apiKey = process.env.TMDB_API_KEY;
  const state = readCheckpoint(CHECKPOINT_PATH);

  console.log(`Objectif : ${TARGET_COUNT} films (les plus populaires selon TMDB).`);

  // --- Étape 1 : liste d'ids (une seule fois, mise en cache par le checkpoint) ---
  let sortedIds = state.sortedIds;
  if (!sortedIds) {
    const raw = await downloadDailyExport();
    const lines = raw.split("\n");
    const entries = [];
    for (const line of lines) {
      const parsed = parseExportLine(line);
      if (parsed) entries.push(parsed);
    }
    entries.sort((a, b) => b.popularity - a.popularity);
    sortedIds = entries.slice(0, TARGET_COUNT * 2).map(e => e.id); // marge : certains films seront filtrés par isUsable
    console.log(`${entries.length} films au total dans l'export. On retient les ${sortedIds.length} plus populaires à traiter.`);
    state.sortedIds = sortedIds;
    state.nextIndex = 0;
    state.imported = 0;
    writeCheckpoint(CHECKPOINT_PATH, state);
  } else {
    console.log(`Reprise : liste d'ids déjà en cache (${sortedIds.length} candidats), position ${state.nextIndex || 0}.`);
  }

  let nextIndex = state.nextIndex || 0;
  let imported = state.imported || 0;
  let failed = state.failed || [];

  while (imported < TARGET_COUNT && nextIndex < sortedIds.length) {
    const tmdbId = sortedIds[nextIndex];
    try {
      const details = await fetchMovieDetails(tmdbId, apiKey);
      const row = mapTmdbMovieToRow(details);
      if (isUsable(row)) {
        const { ok, failed: upsertFailed } = await db.upsertTmdbMovies([row]);
        if (ok) imported++;
        else failed.push({ tmdb_id: tmdbId, reason: upsertFailed[0]?.reason || "upsert échoué" });
      } else {
        failed.push({ tmdb_id: tmdbId, reason: "métadonnées insuffisantes" });
      }
    } catch (e) {
      failed.push({ tmdb_id: tmdbId, reason: e.message });
      console.warn(`Échec film ${tmdbId} : ${e.message}`);
    }

    nextIndex++;
    if (nextIndex % 25 === 0 || imported === TARGET_COUNT) {
      console.log(`${imported}/${TARGET_COUNT} importés (${nextIndex}/${sortedIds.length} candidats traités, ${failed.length} échecs/ignorés)`);
    }
    writeCheckpoint(CHECKPOINT_PATH, { sortedIds, nextIndex, imported, failed });
    await sleep(DELAY_MS);
  }

  console.log(`\nImport terminé : ${imported} films importés dans Postgres, ${failed.length} échecs/ignorés.`);
  if (imported < TARGET_COUNT) {
    console.log("Objectif non atteint avec la marge actuelle — relance la commande, elle continuera plus loin dans la liste (checkpoint conservé).");
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}

module.exports = { run, exportUrlForDate };
