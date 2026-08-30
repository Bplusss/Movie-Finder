#!/usr/bin/env node
// pipeline/resolve-wikidata-refs.js
//
// Étape RÉSOLUTION uniquement : résout progressivement les genres/
// réalisateurs/pays/acteurs des films déjà en base (stade "fetched" ou
// "enriched"). Utilise un cache PERSISTANT partagé (table wikidata_labels) :
// un identifiant déjà résolu pour un autre film n'est jamais redemandé.
// En cas de 429, ralentit et REPREND — n'abandonne jamais un lot de films.
// Relançable à volonté (npm run db:enrich:refs) pour rattraper ce qui reste.
"use strict";
require("dotenv").config();
const wd = require("./lib/wikidata-api");
const refs = require("./lib/wikidata-refs");
const db = require("./lib/db");

const BATCH_SIZE = 50;
const DELAY_MS = 600;
const MAX_MOVIES_PER_RUN = parseInt(process.env.RESOLVE_LIMIT || "2000", 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, label, attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      const isRateLimit = e.status === 429;
      const wait = e.retryAfterMs || (isRateLimit ? 5000 * i : 1000 * i);
      console.warn(`  ⚠️  ${label} — tentative ${i}/${attempts} échouée (${e.message})${isRateLimit ? ` — attente ${Math.round(wait / 1000)}s (limite de débit, on ralentit et on continue)` : ""}`);
      if (i === attempts) { console.warn(`  ↳ échec temporaire conservé pour la prochaine relance (pas un abandon définitif)`); return null; }
      await sleep(wait);
    }
  }
}

async function run() {
  if (!db.isConfigured()) throw new Error("DATABASE_URL manquant.");
  console.log(`[Étape 2/2 — résolution] Recherche des films encore incomplets...`);

  const movies = await db.getMoviesNeedingResolution(MAX_MOVIES_PER_RUN);
  console.log(`${movies.length} film(s) avec des références encore en attente.`);
  if (movies.length === 0) { console.log("Rien à résoudre."); return; }

  const pendingIds = refs.collectPendingIds(movies);
  console.log(`${pendingIds.length} identifiant(s) unique(s) à résoudre (déduplication entre films).`);

  // 1) Ce qui est déjà dans le cache persistant n'est PAS redemandé au réseau.
  const cache = await db.getCachedLabels(pendingIds);
  const alreadyCached = [...cache.keys()];
  const toFetch = pendingIds.filter(id => !cache.has(id) || (!cache.get(id).resolved && cache.get(id).attempts < refs.MAX_ATTEMPTS));
  console.log(`${alreadyCached.length} déjà en cache, ${toFetch.length} à demander à Wikidata.`);

  // 2) Résolution réseau, par lots de 50, avec vrai respect de Retry-After.
  let resolvedCount = 0, unresolvedCount = 0;
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    const entities = await withRetry(() => wd.getEntities(batch), `wbgetentities résolution [${i}/${toFetch.length}]`);

    const cacheEntries = [];
    if (entities) {
      for (const qid of batch) {
        const entity = entities[qid];
        const label = entity ? wd.bestLabel(entity, ["fr", "en"]) : null;
        const prevAttempts = (cache.get(qid) && cache.get(qid).attempts) || 0;
        if (label) { cacheEntries.push({ qid, label, attempts: prevAttempts, resolved: true }); resolvedCount++; cache.set(qid, { label, attempts: prevAttempts, resolved: true }); }
        else { cacheEntries.push({ qid, label: null, attempts: prevAttempts + 1, resolved: false }); unresolvedCount++; cache.set(qid, { label: null, attempts: prevAttempts + 1, resolved: false }); }
      }
    } else {
      // échec réseau persistant pour ce lot -> on incrémente les tentatives sans perdre l'id
      for (const qid of batch) {
        const prevAttempts = (cache.get(qid) && cache.get(qid).attempts) || 0;
        cacheEntries.push({ qid, label: null, attempts: prevAttempts + 1, resolved: false });
        cache.set(qid, { label: null, attempts: prevAttempts + 1, resolved: false });
      }
    }
    await db.upsertLabelCache(cacheEntries);
    const done = Math.min(i + BATCH_SIZE, toFetch.length);
    if (done % 500 < BATCH_SIZE || done === toFetch.length) {
      console.log(`  ${done}/${toFetch.length} identifiants traités (${resolvedCount} résolus, ${unresolvedCount} en échec temporaire)`);
    }
    await sleep(DELAY_MS);
  }

  // 3) Applique le cache (à jour) sur chaque film concerné et écrit le nouveau statut.
  let updatedMovies = 0;
  const statusCounts = { fetched: 0, enriched: 0, complete: 0 };
  for (const movie of movies) {
    const update = refs.applyResolution(movie, cache);
    if (update) {
      await db.applyRefUpdate(movie.id, update);
      updatedMovies++;
      statusCounts[update.wikidata_ref_status]++;
    } else {
      statusCounts[movie.wikidata_ref_status]++;
    }
  }

  console.log(`\nRésolution terminée pour cette passe :`);
  console.log(`  ${resolvedCount} identifiant(s) résolu(s), ${unresolvedCount} en échec temporaire (retentés à la prochaine passe, ou abandonnés proprement après ${refs.MAX_ATTEMPTS} tentatives)`);
  console.log(`  ${updatedMovies} film(s) mis à jour en base.`);
  const totals = await db.refStatusCounts();
  console.log(`  Répartition actuelle des statuts : ${JSON.stringify(totals)}`);
  if (totals.fetched > 0 || totals.enriched > 0) {
    console.log(`\nRelance "npm run db:enrich:refs" pour continuer la résolution de ce qui reste.`);
  }
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
