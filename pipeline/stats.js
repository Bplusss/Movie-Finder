#!/usr/bin/env node
// pipeline/stats.js
// npm run db:stats
"use strict";
require("dotenv").config();
const db = require("./lib/db");

async function run() {
  if (!db.isConfigured()) throw new Error("DATABASE_URL manquant.");
  const s = await db.catalogStats();
  console.log(`Movies: ${s.total}`);
  console.log(`Movies with genres: ${s.with_genres}`);
  console.log(`Movies with year: ${s.with_year}`);
  console.log(`Movies with runtime: ${s.with_runtime}`);
  console.log(`Movies with directors: ${s.with_directors}`);
  console.log(`Movies with actors: ${s.with_actors}`);
  console.log(`Movies enrichis (moods/intensity...): ${s.with_llm_enrichment}`);
  const statusCounts = await db.refStatusCounts();
  console.log(`\nStatut de résolution des références Wikidata :`);
  console.log(`  fetched  (données principales seulement) : ${statusCounts.fetched || 0}`);
  console.log(`  enriched (partiellement résolu)          : ${statusCounts.enriched || 0}`);
  console.log(`  complete (genres/réal./pays/acteurs réglés) : ${statusCounts.complete || 0}`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur :", e.message); process.exit(1); });
}
module.exports = { run };
