#!/usr/bin/env node
// pipeline/prepare-semantic-batches.js
// npm run prepare:semantic-batches
//
// GRATUIT : aucune cle API necessaire. Prepare des petits lots de films
// (donnees Wikidata + texte Wikipedia deja recupere localement) faciles a
// copier-coller dans une conversation Claude pour analyse manuelle.
// LECTURE SEULE sur Supabase (un seul SELECT).
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { selectFilms } = require("./enrich-semantic-100");

const RESULTS_DIR = path.join(__dirname, "test-results");
const WIKIPEDIA_JSON_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const BATCHES_DIR = path.join(RESULTS_DIR, "semantic-batches");
const SAMPLE_SIZE = parseInt(process.env.SEMANTIC_SAMPLE || "100", 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "5", 10);

async function loadFactsFromSupabase(movieIds) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquant.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    `select id, wikidata_id, title, year, runtime_minutes, countries, genres, directors, actors
     from movies where id = any($1)`,
    [movieIds]
  );
  await pool.end();
  return new Map(rows.map(r => [r.id, r]));
}

async function run() {
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_JSON_PATH, "utf8"));
  const selected = selectFilms(wikipediaResults, SAMPLE_SIZE);
  console.log(`${selected.length} films selectionnes (avec intro et/ou synopsis).`);

  const facts = await loadFactsFromSupabase(selected.map(r => r.movie_id));
  console.log(`Faits Wikidata charges pour ${facts.size} films (lecture seule).`);

  const merged = selected.map(r => {
    const fact = facts.get(r.movie_id) || {};
    const data = r.lang_used === "fr" ? r.fr : r.en;
    return {
      movie_id: r.movie_id, wikidata_id: r.wikidata_id, title: r.title,
      wikipedia_language: r.lang_used, wikipedia_title: r.lang_used === "fr" ? r.wikipedia_title_fr : r.wikipedia_title_en,
      year: fact.year || null, runtime_minutes: fact.runtime_minutes || null,
      countries: fact.countries || [], genres: fact.genres || [],
      directors: fact.directors || [], actors: (fact.actors || []).slice(0, 6),
      intro_text: data ? data.intro : null,
      synopsis_text: data ? data.synopsis_text : null,
    };
  });

  fs.mkdirSync(BATCHES_DIR, { recursive: true });
  // Nettoie les anciens lots pour ne pas melanger une ancienne generation
  fs.readdirSync(BATCHES_DIR).forEach(f => fs.unlinkSync(path.join(BATCHES_DIR, f)));

  const totalBatches = Math.ceil(merged.length / BATCH_SIZE);
  for (let i = 0; i < totalBatches; i++) {
    const batch = merged.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    const num = String(i + 1).padStart(2, "0");
    fs.writeFileSync(path.join(BATCHES_DIR, `batch-${num}.json`), JSON.stringify(batch, null, 2));
  }

  console.log(`\n${totalBatches} lots de ${BATCH_SIZE} films ecrits dans pipeline/test-results/semantic-batches/`);
  console.log(`Ouvre batch-01.json, copie tout son contenu, colle-le dans la conversation avec Claude.`);
  console.log(`Repete pour chaque lot jusqu'a batch-${String(totalBatches).padStart(2, "0")}.json.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
