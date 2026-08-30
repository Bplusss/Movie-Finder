#!/usr/bin/env node
// pipeline/import-wikidata.js
//
// Import réel depuis Wikidata, côté serveur (jamais depuis le navigateur).
// Idempotent (upsert par wikidata_id), relançable (checkpoint sur disque),
// tolérant aux erreurs (un film en échec n'arrête pas le lot).
//
// Prérequis pour l'exécuter réellement (nécessite un accès réseau sortant,
// absent de l'environnement où ce prototype a été écrit) :
//   npm install pg
//   export DATABASE_URL=postgres://user:pass@host:5432/moviefinder
//   node pipeline/import-wikidata.js
//
"use strict";
require("dotenv").config();
const path = require("path");
const { buildFilmIdsQuery, buildDetailsQuery, groupBindings, toMovieRow, isUsable } = require("./lib/wikidata");
const { readCheckpoint, writeCheckpoint } = require("./lib/checkpoint");

const CHECKPOINT_PATH = path.join(__dirname, ".checkpoint-wikidata.json");
const PAGE_SIZE = 100; // volontairement petit : chaque page déclenche une 2e requête "détails"
const TARGET_COUNT = parseInt(process.env.WIKIDATA_TARGET || "10000", 10);
const ENDPOINT = "https://query.wikidata.org/sparql";
const HEADERS = {
  Accept: "application/sparql-results+json",
  "User-Agent": "MovieFinderImportBot/1.0 (prototype; contact: à-completer@example.com)",
};

async function sparqlQuery(query) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw new Error(`Wikidata HTTP ${resp.status}`);
  const data = await resp.json();
  return data.results.bindings;
}

/** Étape 1 : identifiants de films pour cette page (requête légère). */
async function fetchFilmIds(offset, limit) {
  const bindings = await sparqlQuery(buildFilmIdsQuery({ offset, limit }));
  return bindings.map(b => b.film.value);
}

/** Étape 2 : détails pour un lot restreint d'identifiants (VALUES -> rapide). */
async function fetchDetails(filmUris) {
  if (filmUris.length === 0) return [];
  return sparqlQuery(buildDetailsQuery(filmUris));
}

async function upsertMovies(rows) {
  const db = require("./lib/db");
  if (db.isConfigured()) {
    const { ok, failed } = await db.upsertWikidataMovies(rows);
    if (failed.length) console.warn(`${failed.length} échecs d'upsert Postgres (voir détail ci-dessous)`, failed.slice(0, 5));
    return ok;
  }
  // Repli sans base connectée : JSONL append-only (utile pour tester la logique hors-ligne)
  const fs = require("fs");
  const out = path.join(__dirname, "output-movies.jsonl");
  const lines = rows.map(r => JSON.stringify(r)).join("\n") + "\n";
  fs.appendFileSync(out, lines);
  return rows.length;
}

async function run() {
  const state = readCheckpoint(CHECKPOINT_PATH);
  let { offset, failed } = state;
  let imported = 0;
  let skippedIncomplete = 0;

  console.log(`Reprise à l'offset ${offset}. Objectif : ${TARGET_COUNT} films utilisables.`);

  while (imported < TARGET_COUNT) {
    let filmUris;
    try {
      filmUris = await fetchFilmIds(offset, PAGE_SIZE);
    } catch (e) {
      console.warn(`Échec réseau (étape 1, offset ${offset}) : ${e.message}. Nouvelle tentative dans 5s...`);
      await sleep(5000);
      continue;
    }

    if (filmUris.length === 0) {
      console.log("Fin des résultats disponibles côté Wikidata pour ce filtre de notoriété.");
      break;
    }

    let bindings;
    try {
      bindings = await fetchDetails(filmUris);
    } catch (e) {
      console.warn(`Échec réseau (étape 2/détails, offset ${offset}) : ${e.message}. Nouvelle tentative dans 5s...`);
      await sleep(5000);
      continue; // on retente la MÊME page (même offset), pas la suivante
    }

    const films = groupBindings(bindings);
    const rowsToInsert = [];
    for (const film of films) {
      try {
        const row = toMovieRow(film);
        if (!isUsable(row)) {
          skippedIncomplete++;
          failed.push({ wikidata_id: row.wikidata_id, reason: "métadonnées insuffisantes" });
          continue;
        }
        rowsToInsert.push(row);
      } catch (e) {
        failed.push({ wikidata_id: film.wikidata_id, reason: e.message });
      }
    }

    const ok = await upsertMovies(rowsToInsert);
    imported += ok;
    offset += PAGE_SIZE;

    writeCheckpoint(CHECKPOINT_PATH, { offset, failed, done: false });
    console.log(`${imported}/${TARGET_COUNT} films importés (offset ${offset}, ${skippedIncomplete} ignorés pour métadonnées insuffisantes)`);

    await sleep(1000); // on ménage le point d'accès public de Wikidata
  }

  writeCheckpoint(CHECKPOINT_PATH, { offset, failed, done: true });
  console.log(`\nImport terminé : ${imported} films importés, ${failed.length} échecs/ignorés.`);
  if (failed.length) {
    console.log("Échecs consignés dans le checkpoint pour relance ciblée :", CHECKPOINT_PATH);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

if (require.main === module) {
  run().catch(e => {
    console.error("Erreur fatale (ne devrait arriver que pour une panne de configuration) :", e);
    process.exit(1);
  });
}

module.exports = { run };
