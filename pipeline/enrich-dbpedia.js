#!/usr/bin/env node
// pipeline/enrich-dbpedia.js
// npm run db:enrich:dbpedia
//
// Passe SÉPARÉE et relançable : ne s'occupe que du synopsis (DBpedia), sur
// les films déjà en base qui n'en ont pas encore. Aucune dépendance à
// l'étape de récupération Wikidata — une panne DBpedia ne ralentit donc plus
// jamais l'import des films eux-mêmes.
//
// Pas de fichier de reprise séparé : l'état "à faire" est recalculé à chaque
// lancement directement depuis la base (synopsis_source IS NULL), donc on
// peut interrompre et relancer cette commande autant de fois que nécessaire.
"use strict";
require("dotenv").config();
const wd = require("./lib/wikidata-api");
const dbpedia = require("./lib/dbpedia-api");
const db = require("./lib/db");

const BATCH_SIZE = 50;
const DELAY_MS = 600;
const LIMIT = parseInt(process.env.DBPEDIA_LIMIT || "2000", 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, label, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const isRateLimit = e.status === 429;
      const wait = e.retryAfterMs || (isRateLimit ? 5000 * i : 2000 * i);
      console.warn(`  ⚠️  ${label} — tentative ${i}/${attempts} échouée (${e.message})${isRateLimit ? ` — attente ${Math.round(wait/1000)}s (limite de débit)` : ""}`);
      if (i < attempts) await sleep(wait);
    }
  }
  throw lastErr; // toutes les tentatives réseau ont échoué -> distinct d'un "vraiment absent de DBpedia"
}

/** Rattrapage : certains films importés avant ce correctif n'ont pas encore leur titre anglais Wikipédia en base. */
async function backfillEnglishTitles() {
  const missing = await db.getMoviesMissingEnTitle(LIMIT);
  if (missing.length === 0) return;
  console.log(`Rattrapage : ${missing.length} film(s) sans titre anglais Wikipédia connu — récupération via Wikidata...`);

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE);
    let entities;
    try {
      entities = await withRetry(() => wd.getEntities(batch.map(m => m.wikidata_id)), `wbgetentities rattrapage [${i}]`, 5);
    } catch (e) { continue; } // ce lot est retenté au prochain lancement, pas d'invention
    for (const movie of batch) {
      const entity = entities[movie.wikidata_id];
      const enTitle = entity && entity.sitelinks && entity.sitelinks.enwiki ? entity.sitelinks.enwiki.title : null;
      if (enTitle) { await db.updateWikipediaTitleEn(movie.id, enTitle); movie.wikipedia_title_en = enTitle; }
    }
    await sleep(DELAY_MS);
  }
}

async function run() {
  if (!db.isConfigured()) throw new Error("DATABASE_URL manquant.");
  console.log(`[Enrichissement DBpedia] Recherche des films sans synopsis...`);

  await backfillEnglishTitles();

  const movies = await db.getMoviesMissingSynopsis(LIMIT);
  const withTitle = movies.filter(m => m.wikipedia_title_en);
  const withoutTitle = movies.length - withTitle.length;
  console.log(`${movies.length} film(s) sans synopsis (${withTitle.length} avec un titre anglais exploitable, ${withoutTitle} sans — ignorés, jamais devinés).`);
  if (withTitle.length === 0) { console.log("Rien à enrichir pour l'instant."); return; }

  let ok = 0, notFoundOnDbpedia = 0, failed = 0;
  for (let i = 0; i < withTitle.length; i++) {
    const movie = withTitle[i];
    try {
      const result = await withRetry(() => dbpedia.fetchSynopsis(movie.wikipedia_title_en), `DBpedia "${movie.title}"`, 3);
      if (result) { await db.applyDbpediaSynopsis(movie.id, result); ok++; }
      else { notFoundOnDbpedia++; } // réponse valide de DBpedia, juste pas de fiche pour ce film -> jamais réessayé inutilement
    } catch (e) {
      failed++; // échec réseau après 3 tentatives -> retenté au prochain lancement
    }
    if ((i + 1) % 50 === 0 || i === withTitle.length - 1) {
      console.log(`  ${i + 1}/${withTitle.length} traités (${ok} enrichis, ${notFoundOnDbpedia} absents de DBpedia, ${failed} échecs réseau à retenter)`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nEnrichissement DBpedia terminé pour cette passe : ${ok} synopsis ajoutés, ${notFoundOnDbpedia} films sans fiche DBpedia, ${failed} échecs réseau.`);
  if (failed > 0) console.log(`Relance "npm run db:enrich:dbpedia" pour retenter les échecs réseau.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
