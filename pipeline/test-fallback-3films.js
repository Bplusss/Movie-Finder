#!/usr/bin/env node
// pipeline/test-fallback-3films.js
// npm run test:fallback-3films
//
// Teste la cascade de fallback sur 3 films representatifs, PAS les 38.
// Met a jour le cache UNIQUEMENT pour ces 3 films s'ils reussissent (jamais
// les 980 succes existants, jamais les 35 autres echecs).
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const ollama = require("./lib/ollama-client");
const semantic = require("./lib/semantic-profile-v2");
const { runWithFallback } = require("./lib/semantic-fallback");
const consistency = require("./lib/consistency-checks");

const RESULTS_DIR = path.join(__dirname, "test-results");
const WIKIPEDIA_JSON_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const CACHE_PATH = path.join(RESULTS_DIR, "semantic-cache-1018.json");
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct";

const TEST_WIKIDATA_IDS = ["Q102244", "Q163872", "Q1197185"]; // Chambre des secrets, Dark Knight, L'Etoffe des heros

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function saveJsonAtomic(p, obj) {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, p);
}

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
  console.log(`[Test fallback — 3 films] Verification qu'Ollama tourne...`);
  const status = await ollama.checkOllamaRunning();
  if (!status.running) throw new Error(`Ollama ne repond pas sur ${ollama.BASE_URL}.`);
  console.log(`Ollama actif (${MODEL}).\n`);

  const wikipediaResults = loadJson(WIKIPEDIA_JSON_PATH);
  const wikipediaByWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  const cache = loadJson(CACHE_PATH);

  const targets = TEST_WIKIDATA_IDS.map(id => wikipediaByWikidataId.get(id)).filter(Boolean);
  const facts = await loadFactsFromSupabase(targets.map(r => r.movie_id));

  const levelCounts = { 1: 0, 2: 0, 3: 0, needs_review: 0 };
  const results = [];

  for (const wid of TEST_WIKIDATA_IDS) {
    const r = wikipediaByWikidataId.get(wid);
    if (!r) { console.log(`Film ${wid} introuvable dans wikipedia-synopsis-1018.json — ignore.\n`); continue; }

    const fact = facts.get(r.movie_id) || {};
    const data = r.lang_used === "fr" ? r.fr : r.en;
    const film = {
      title: r.title, year: fact.year, runtime_minutes: fact.runtime_minutes,
      countries: fact.countries || [], genres: fact.genres || [],
      directors: fact.directors || [], actors: fact.actors || [],
      intro_text: data ? data.intro : null,
      synopsis_text: data ? data.synopsis_text : null,
    };

    console.log(`\n${"=".repeat(60)}`);
    console.log(`FILM : ${r.title} (${wid})`);
    console.log(`${"=".repeat(60)}`);

    const start = Date.now();
    const result = await runWithFallback(film, { model: MODEL });
    const totalMs = Date.now() - start;

    result.attempts.forEach(a => {
      console.log(`  Niveau ${a.level} : ${a.valid ? "SUCCES" : `echec [${a.errorType}]${a.error ? " — " + a.error.slice(0, 100) : ""}`}`);
    });

    if (result.status === "success") {
      levelCounts[result.level]++;
      const nulls = semantic.countNulls(result.profile);
      const warnings = consistency.checkConsistency(result.profile);
      console.log(`\n  -> REUSSI au niveau ${result.level}, ${(totalMs / 1000).toFixed(1)}s au total, ${nulls} null(s), ${warnings.length} warning(s)`);
      console.log(`  Profil : ${JSON.stringify(result.profile, null, 2)}`);

      // Sauvegarde UNIQUEMENT ce film precis dans le cache (jamais les autres)
      cache[wid] = {
        wikidata_id: wid, title: r.title, year: fact.year,
        source: { wikipedia_language: r.lang_used, wikipedia_title: r.lang_used === "fr" ? r.wikipedia_title_fr : r.wikipedia_title_en, has_intro: Boolean(film.intro_text), has_synopsis: Boolean(film.synopsis_text) },
        facts: { genres: fact.genres, directors: fact.directors, actors: fact.actors, runtime_minutes: fact.runtime_minutes, countries: fact.countries },
        semantic_profile: result.profile,
        generation_time_ms: totalMs, corrections: result.corrections || [], warnings,
        status: "success", attempts: (cache[wid] ? cache[wid].attempts || 0 : 0) + result.attempts.length,
        recovered_via_fallback_level: result.level,
      };
      saveJsonAtomic(CACHE_PATH, cache);
      console.log(`  Cache mis a jour pour CE FILM UNIQUEMENT.`);
    } else {
      levelCounts.needs_review++;
      console.log(`\n  -> NEEDS_REVIEW : les 3 niveaux ont echoue, ${(totalMs / 1000).toFixed(1)}s au total, aucune donnee fabriquee.`);
      cache[wid] = {
        ...cache[wid], wikidata_id: wid, title: r.title, status: "needs_review",
        attempts: (cache[wid] ? cache[wid].attempts || 0 : 0) + result.attempts.length,
        fallback_history: result.attempts,
      };
      saveJsonAtomic(CACHE_PATH, cache);
    }

    results.push({ title: r.title, wikidata_id: wid, status: result.status, level: result.level || null });
  }

  console.log(`\n\n=== BILAN DES 3 FILMS TESTES ===`);
  results.forEach(r => console.log(`  ${r.title} : ${r.status === "success" ? `succes niveau ${r.level}` : "needs_review"}`));
  console.log(`\nReussis au niveau 1 : ${levelCounts[1]}`);
  console.log(`Reussis au niveau 2 : ${levelCounts[2]}`);
  console.log(`Reussis au niveau 3 : ${levelCounts[3]}`);
  console.log(`En needs_review     : ${levelCounts.needs_review}`);
  console.log(`\nAucune ecriture Supabase n'a ete faite.`);
  console.log(`Seuls ces 3 films ont ete modifies dans le cache — les 980 succes et les 35 autres echecs sont intacts.`);
  console.log(`\nEn attente de ton feu vert avant de lancer les 38.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run };
