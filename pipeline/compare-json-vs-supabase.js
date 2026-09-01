#!/usr/bin/env node
// pipeline/compare-json-vs-supabase.js
// node pipeline/compare-json-vs-supabase.js
//
// PHASE 6 de la migration. Lance les 60 requetes de reference (deja
// existantes dans benchmark-60.js, reutilisees telles quelles) sur les DEUX
// sources (JSON et Supabase), et compare : IDs retournes, ordre, scores,
// filtres detectes, nombre de resultats. movie-search-v3.js est appele de
// facon strictement identique des deux cotes -- seule la source change.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { loadCatalog } = require("./lib/local-catalog");
const { loadCatalogFromSupabase } = require("./lib/load-catalog-from-supabase");
const { buildGazetteer } = require("./lib/entity-gazetteer");
const { searchV3 } = require("./lib/movie-search-v3");
const { STRUCTURED, GENRES, SUBJECTS, NARRATIVE, AMBIANCE, HYBRID } = require("./benchmark-60");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");

function buildTextFieldsJson(finalCatalogMovies, wikipediaResults) {
  const byWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  return finalCatalogMovies.map(m => {
    const r = byWikidataId.get(m.wikidata_id);
    const data = r ? (r.lang_used === "fr" ? r.fr : r.en) : null;
    return { ...m, introText: data && data.intro ? data.intro : "", synopsisOnlyText: data && data.synopsis_text ? data.synopsis_text : "" };
  });
}

const ALL_QUERIES = [...STRUCTURED, ...GENRES, ...SUBJECTS, ...NARRATIVE, ...AMBIANCE, ...HYBRID];

function resultSignature(result) {
  return {
    filters: result.filters,
    semantic_query: result.semantic_query,
    family: result.family,
    pool_size: result.pool_size,
    ids_in_order: result.ranked.map(r => r.movie.wikidata_id),
    scores: result.ranked.map(r => r.total),
  };
}

function compareSignatures(a, b) {
  const diffs = [];
  if (JSON.stringify(a.filters) !== JSON.stringify(b.filters)) diffs.push(`filtres differents : ${JSON.stringify(a.filters)} vs ${JSON.stringify(b.filters)}`);
  if (a.semantic_query !== b.semantic_query) diffs.push(`reste semantique different : "${a.semantic_query}" vs "${b.semantic_query}"`);
  if (a.family !== b.family) diffs.push(`famille differente : ${a.family} vs ${b.family}`);
  if (a.pool_size !== b.pool_size) diffs.push(`taille du pool differente : ${a.pool_size} vs ${b.pool_size}`);
  if (JSON.stringify(a.ids_in_order) !== JSON.stringify(b.ids_in_order)) diffs.push(`IDs ou ordre differents :\n      JSON     : ${JSON.stringify(a.ids_in_order)}\n      Supabase : ${JSON.stringify(b.ids_in_order)}`);
  if (JSON.stringify(a.scores) !== JSON.stringify(b.scores)) diffs.push(`scores differents : ${JSON.stringify(a.scores)} vs ${JSON.stringify(b.scores)}`);
  return diffs;
}

async function run() {
  console.log("Chargement du catalogue JSON...");
  const { movies: jsonMoviesRaw } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const jsonCatalog = buildTextFieldsJson(jsonMoviesRaw, wikipediaResults);
  const jsonGazetteer = buildGazetteer(jsonCatalog);

  console.log("Chargement du catalogue Supabase...");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL non definie.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { movies: supabaseCatalog } = await loadCatalogFromSupabase(pool);
  const supabaseGazetteer = buildGazetteer(supabaseCatalog);
  await pool.end();

  console.log(`JSON : ${jsonCatalog.length} films | Supabase : ${supabaseCatalog.length} films\n`);
  console.log(`Comparaison sur ${ALL_QUERIES.length} requetes de reference (sans embeddings -- lexical + filtres durs uniquement, comparaison deterministe)...\n`);

  let identical = 0, withDiffs = 0;
  const problems = [];

  for (const q of ALL_QUERIES) {
    const rJson = await searchV3(jsonCatalog, jsonGazetteer, q, {});
    const rSupabase = await searchV3(supabaseCatalog, supabaseGazetteer, q, {});
    const sigJson = resultSignature(rJson), sigSupabase = resultSignature(rSupabase);
    const diffs = compareSignatures(sigJson, sigSupabase);
    if (diffs.length === 0) identical++;
    else { withDiffs++; problems.push({ query: q, diffs }); }
  }

  console.log(`=== RESULTAT ===`);
  console.log(`Requetes identiques   : ${identical}/${ALL_QUERIES.length}`);
  console.log(`Requetes divergentes  : ${withDiffs}/${ALL_QUERIES.length}`);

  if (problems.length) {
    console.log(`\n=== DETAIL DES DIVERGENCES ===`);
    problems.forEach(p => {
      console.log(`\n"${p.query}"`);
      p.diffs.forEach(d => console.log(`  - ${d}`));
    });
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(withDiffs === 0
    ? `SUCCES : les resultats sont identiques sur les deux sources.`
    : `ECHEC — des divergences existent. NE PAS basculer en production. Chercher une difference de donnee/mapping, jamais corriger le moteur.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run, resultSignature, compareSignatures };
