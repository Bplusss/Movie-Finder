#!/usr/bin/env node
// pipeline/fetch-wikidata-films.js
//
// Étape RÉCUPÉRATION uniquement : découvre des films et enregistre
// immédiatement leurs données principales (titre, année, durée, imdb...).
// Les catégories essentielles (genres/réalisateurs/pays/acteurs) sont
// stockées en Q-ids non résolus — jamais résolues ici, jamais bloquantes.
// Le synopsis DBpedia N'EST PLUS tenté ici (découplé, voir
// pipeline/enrich-dbpedia.js) : une panne DBpedia ne ralentit plus jamais
// la récupération des films eux-mêmes.
//
// Variables : DATABASE_URL (obligatoire), CATALOG_TARGET=50
"use strict";
require("dotenv").config();
const path = require("path");
const wd = require("./lib/wikidata-api");
const refs = require("./lib/wikidata-refs");
const db = require("./lib/db");
const { readCheckpoint, writeCheckpoint } = require("./lib/checkpoint");

const CHECKPOINT_PATH = path.join(__dirname, ".checkpoint-fetch.json");
const TARGET_COUNT = parseInt(process.env.CATALOG_TARGET || "50", 10);
const BATCH_SIZE = 50;
const DELAY_MS = 600;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, label, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      const isRateLimit = e.status === 429;
      const wait = e.retryAfterMs || (isRateLimit ? 5000 * i : 1000 * i);
      console.warn(`  ⚠️  ${label} — tentative ${i}/${attempts} échouée (${e.message})${isRateLimit ? ` — attente ${Math.round(wait / 1000)}s (limite de débit)` : ""}`);
      if (i === attempts) throw e;
      await sleep(wait);
    }
  }
}

async function run() {
  if (!db.isConfigured()) throw new Error("DATABASE_URL manquant.");
  console.log(`[Étape 1/2 — récupération] Objectif : ${TARGET_COUNT} films.`);

  const state = readCheckpoint(CHECKPOINT_PATH);
  let offset = state.offset || 0;
  let fetched = state.fetched || 0;
  let seenIds = new Set(state.seenIds || []);
  let skipped = state.skipped || [];

  while (fetched < TARGET_COUNT) {
    const remaining = TARGET_COUNT - fetched;
    const srlimit = Math.min(50, remaining + 5);
    let searchResult;
    try {
      searchResult = await withRetry(() => wd.searchFilmIds({ srlimit, sroffset: offset }), `recherche offset=${offset}`);
    } catch (e) {
      console.error(`Échec définitif de la recherche à l'offset ${offset} : ${e.message}`);
      break;
    }
    const newIds = searchResult.ids.filter(id => !seenIds.has(id));
    newIds.forEach(id => seenIds.add(id));

    for (let i = 0; i < newIds.length && fetched < TARGET_COUNT; i += BATCH_SIZE) {
      const batch = newIds.slice(i, i + BATCH_SIZE);
      let entities;
      try {
        entities = await withRetry(() => wd.getEntities(batch), `wbgetentities films [${i}]`);
      } catch (e) {
        batch.forEach(qid => skipped.push({ wikidata_id: qid, reason: `wbgetentities échoué : ${e.message}` }));
        await sleep(DELAY_MS);
        continue;
      }

      for (const qid of batch) {
        const entity = entities[qid];
        if (!entity || entity.missing !== undefined) { skipped.push({ wikidata_id: qid, reason: "entité introuvable" }); continue; }

        const raw = wd.extractRawFilm(entity);
        const row = wd.buildFetchedRow(raw);
        if (!wd.isUsable(row)) { skipped.push({ wikidata_id: qid, reason: "métadonnées principales insuffisantes" }); continue; }

        row.unresolved_refs = refs.buildInitialUnresolvedRefs(raw);
        row.wikidata_ref_status = refs.computeRefStatus(row.unresolved_refs);

        try {
          await db.upsertFetchedMovie(row);
          fetched++;
        } catch (e) {
          skipped.push({ wikidata_id: qid, reason: `upsert échoué : ${e.message}` });
        }
      }
      await sleep(DELAY_MS);

      offset = searchResult.nextOffset;
      writeCheckpoint(CHECKPOINT_PATH, { offset, fetched, seenIds: [...seenIds], skipped });
      console.log(`${fetched}/${TARGET_COUNT} films récupérés (${skipped.length} ignorés au total)`);
    }

    if (searchResult.nextOffset == null) { console.log("Fin des résultats de recherche Wikidata."); break; }
    offset = searchResult.nextOffset;
  }

  console.log(`\nRécupération terminée : ${fetched} films dans Postgres (stade "fetched"/"enriched"/"complete" selon les cas), ${skipped.length} ignorés/échoués.`);
  if (skipped.length) console.log("Détail des 5 premiers ignorés :", skipped.slice(0, 5));
  console.log(`\nLance maintenant :`);
  console.log(`  npm run db:enrich:refs      (résolution progressive des genres/réalisateurs/pays/acteurs)`);
  console.log(`  npm run db:enrich:dbpedia   (synopsis, indépendant, peut tourner à tout moment)`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
