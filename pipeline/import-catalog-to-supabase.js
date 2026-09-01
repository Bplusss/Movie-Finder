#!/usr/bin/env node
// pipeline/import-catalog-to-supabase.js
// node pipeline/import-catalog-to-supabase.js
//
// PHASE 2 de la migration catalogue V3.2 -> Supabase. Importe les 1018 films
// dans `movies_catalog` (JAMAIS `movies`, la table brute preexistante).
// IDEMPOTENT : upsert sur wikidata_id, relancer plusieurs fois ne cree jamais
// de doublon ni ne genere de nouvel ID pour un film existant. Ne supprime
// JAMAIS de film automatiquement. N'importe rien vers `movies` (deja
// existante), ne touche pas au moteur.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { loadCatalog } = require("./lib/local-catalog");
const { buildTextFields } = require("./audit-catalog-for-migration");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");

function isValid(movie) {
  const errors = [];
  if (!movie.wikidata_id) errors.push("wikidata_id manquant");
  if (!movie.title || !movie.title.trim()) errors.push("title manquant/vide");
  return errors;
}

async function importCatalog(pool, movies) {
  const report = { read: movies.length, valid: 0, invalid: 0, inserted: 0, updated: 0, errors: [] };

  for (const m of movies) {
    const validationErrors = isValid(m);
    if (validationErrors.length) {
      report.invalid++;
      report.errors.push({ wikidata_id: m.wikidata_id || "(absent)", title: m.title || "(absent)", reason: validationErrors.join("; ") });
      continue;
    }
    report.valid++;

    try {
      const result = await pool.query(
        `insert into movies_catalog
          (wikidata_id, movie_id, title, year, runtime_minutes, countries, genres, directors, actors,
           wikipedia_language, wikipedia_title, intro_text, synopsis_text,
           semantic_profile, semantic_status, semantic_warnings, adult_content, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
         on conflict (wikidata_id) do update set
           movie_id = excluded.movie_id, title = excluded.title, year = excluded.year,
           runtime_minutes = excluded.runtime_minutes, countries = excluded.countries,
           genres = excluded.genres, directors = excluded.directors, actors = excluded.actors,
           wikipedia_language = excluded.wikipedia_language, wikipedia_title = excluded.wikipedia_title,
           intro_text = excluded.intro_text, synopsis_text = excluded.synopsis_text,
           semantic_profile = excluded.semantic_profile, semantic_status = excluded.semantic_status,
           semantic_warnings = excluded.semantic_warnings, adult_content = excluded.adult_content,
           updated_at = now()
         returning (xmax = 0) as inserted`,
        [
          m.wikidata_id, m.movie_id || null, m.title,
          m.facts ? m.facts.year : null, m.facts ? m.facts.runtime_minutes : null,
          JSON.stringify(m.facts ? m.facts.countries || [] : []), JSON.stringify(m.facts ? m.facts.genres || [] : []),
          JSON.stringify(m.facts ? m.facts.directors || [] : []), JSON.stringify(m.facts ? m.facts.actors || [] : []),
          m.source ? m.source.wikipedia_language : null, m.source ? m.source.wikipedia_title : null,
          m.introText || null, m.synopsisOnlyText || null,
          JSON.stringify(m.semantic_profile || {}), m.semantic_status || null,
          JSON.stringify(m.semantic_warnings || []), JSON.stringify(m.adult_content || {}),
        ]
      );
      if (result.rows[0].inserted) report.inserted++; else report.updated++;
    } catch (e) {
      report.invalid++; report.valid--;
      report.errors.push({ wikidata_id: m.wikidata_id, title: m.title, reason: `erreur SQL : ${e.message}` });
    }
  }
  return report;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL non definie.");
  const { movies } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const merged = buildTextFields(movies, wikipediaResults);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const report = await importCatalog(pool, merged);
    const { rows } = await pool.query("select count(*)::int as n from movies_catalog");
    const actualFinalCount = rows[0].n;

    console.log(`=== IMPORT CATALOGUE -> movies_catalog ===\n`);
    console.log(`Films lus dans le JSON      : ${report.read}`);
    console.log(`Valides                     : ${report.valid}`);
    console.log(`Invalides (ignores)         : ${report.invalid}`);
    console.log(`Inserts                     : ${report.inserted}`);
    console.log(`Mises a jour                : ${report.updated}`);
    console.log(`Attendu en base (au moins)  : ${report.valid}`);
    console.log(`Reellement en base          : ${actualFinalCount}`);
    if (report.errors.length) {
      console.log(`\nErreurs detaillees (${report.errors.length}) :`);
      report.errors.forEach(e => console.log(`  - ${e.title} (${e.wikidata_id}) : ${e.reason}`));
    }
    if (actualFinalCount < report.valid) {
      console.log(`\nATTENTION : le compte reel en base est INFERIEUR au nombre de films valides traites -- a investiguer avant de continuer.`);
    }
    console.log(`\nRelancer ce script ne cree jamais de doublon (upsert sur wikidata_id). Aucune suppression n'a ete effectuee. Table 'movies' non touchee.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run, importCatalog, isValid };
