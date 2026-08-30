#!/usr/bin/env node
// pipeline/build-final-dataset.js
// npm run build:final-dataset
//
// Fusionne wikipedia-synopsis-1018.json + semantic-cache-1018.json + faits
// Wikidata (Supabase, LECTURE SEULE) en un seul fichier final. NE SUPPRIME
// JAMAIS un film, meme si son profil semantique est absent/incomplet.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const semantic = require("./lib/semantic-profile-v2");
const { checkAdultContent } = require("./lib/adult-content-check");

const RESULTS_DIR = path.join(__dirname, "test-results");
const WIKIPEDIA_JSON_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const CACHE_PATH = path.join(RESULTS_DIR, "semantic-cache-1018.json");
const OUTPUT_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

async function loadFactsFromSupabase(movieIds) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquant.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Lecture seule : uniquement un SELECT. Aucune ecriture dans ce script.
  const { rows } = await pool.query(
    `select id, wikidata_id, title, year, runtime_minutes, countries, genres, directors, actors
     from movies where id = any($1)`,
    [movieIds]
  );
  await pool.end();
  return new Map(rows.map(r => [r.id, r]));
}

/** Profil semantique "vide" (tout null) — utilise quand aucun profil n'a pu etre genere, pour ne jamais perdre le film. */
function emptyProfile() {
  const p = {};
  for (const f of semantic.ALL_FIELDS) p[f] = null;
  return p;
}

async function run() {
  const wikipediaResults = loadJson(WIKIPEDIA_JSON_PATH);
  const cache = loadJson(CACHE_PATH);
  console.log(`${wikipediaResults.length} films (ordre de reference), ${Object.keys(cache).length} entrees dans le cache semantique.`);

  const facts = await loadFactsFromSupabase(wikipediaResults.map(r => r.movie_id));
  console.log(`Faits Wikidata charges pour ${facts.size} films (lecture seule).`);

  const final = wikipediaResults.map(r => {
    const fact = facts.get(r.movie_id) || {};
    const cacheEntry = cache[r.wikidata_id];
    const data = r.lang_used === "fr" ? r.fr : r.en;
    const textForAdultCheck = [data ? data.intro : null, data ? data.synopsis_text : null].filter(Boolean).join(" ");
    const adultCheck = checkAdultContent(r.title, textForAdultCheck);

    const hasProfile = cacheEntry && cacheEntry.status === "success";

    return {
      movie_id: r.movie_id,
      wikidata_id: r.wikidata_id,
      title: r.title,
      facts: {
        year: fact.year ?? null, runtime_minutes: fact.runtime_minutes ?? null,
        countries: fact.countries || [], genres: fact.genres || [],
        directors: fact.directors || [], actors: fact.actors || [],
      },
      source: {
        wikipedia_language: r.lang_used || null,
        wikipedia_title: r.lang_used === "fr" ? r.wikipedia_title_fr : r.wikipedia_title_en,
      },
      semantic_profile: hasProfile ? cacheEntry.semantic_profile : emptyProfile(),
      semantic_status: cacheEntry ? cacheEntry.status : "no_attempt",
      semantic_warnings: hasProfile ? (cacheEntry.warnings || []) : [],
      adult_content: {
        flagged: adultCheck.flagged,
        matched_terms: adultCheck.matched_terms,
        method: "heuristique texte (titre+synopsis) — pas une garantie, cf. pipeline/lib/adult-content-check.js",
      },
    };
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(final, null, 2));

  const withProfile = final.filter(f => f.semantic_status === "success").length;
  const flaggedAdult = final.filter(f => f.adult_content.flagged).length;
  console.log(`\n=== DATASET FINAL CONSTRUIT ===`);
  console.log(`Total films              : ${final.length}`);
  console.log(`Avec profil semantique   : ${withProfile}`);
  console.log(`Sans profil (conserves, jamais supprimes) : ${final.length - withProfile}`);
  console.log(`Signales adult_content   : ${flaggedAdult}`);
  console.log(`\nEcrit dans : ${OUTPUT_PATH}`);
  console.log(`Aucune ecriture Supabase n'a ete faite.`);

  if (flaggedAdult > 0) {
    console.log(`\nFilms signales (a verifier manuellement) :`);
    final.filter(f => f.adult_content.flagged).forEach(f => {
      console.log(`  - ${f.title} (${f.wikidata_id}) — termes: ${f.adult_content.matched_terms.join(", ")}`);
    });
  }
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run, emptyProfile };
