#!/usr/bin/env node
// pipeline/retry-semantic-failures.js
// npm run retry:semantic-failures
//
// Retraite UNIQUEMENT les films en echec dans le cache. Les succes existants
// ne sont JAMAIS relus ni retouches. LECTURE SEULE sur Supabase.
//
// Variables :
//   RETRY_LIMIT=5   limite le nombre de films retentes cette passe (mini-test avant le lot complet)
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const ollama = require("./lib/ollama-client");
const semantic = require("./lib/semantic-profile-v2");
const consistency = require("./lib/consistency-checks");
const { runWithFallback } = require("./lib/semantic-fallback");

const RESULTS_DIR = path.join(__dirname, "test-results");
const WIKIPEDIA_JSON_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const CACHE_PATH = path.join(RESULTS_DIR, "semantic-cache-1018.json");

const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct";
const RETRY_LIMIT = process.env.RETRY_LIMIT ? parseInt(process.env.RETRY_LIMIT, 10) : Infinity;

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
  console.log(`[Recuperation ciblee des echecs] Verification qu'Ollama tourne...`);
  const status = await ollama.checkOllamaRunning();
  if (!status.running) throw new Error(`Ollama ne repond pas sur ${ollama.BASE_URL}.`);
  if (!status.models.some(m => m.startsWith(MODEL.split(":")[0]))) throw new Error(`Modele "${MODEL}" non installe.`);
  console.log(`Ollama actif (${MODEL}).`);

  const wikipediaResults = loadJson(WIKIPEDIA_JSON_PATH);
  const wikipediaByWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  const cache = loadJson(CACHE_PATH);

  const successCountBefore = Object.values(cache).filter(e => e.status === "success").length;
  const failedEntries = Object.values(cache).filter(e => e.status !== "success");
  console.log(`Cache : ${successCountBefore} succes (intouches), ${failedEntries.length} echec(s) a retraiter.`);

  const toRetry = failedEntries.slice(0, RETRY_LIMIT === Infinity ? failedEntries.length : RETRY_LIMIT);
  console.log(`Cette passe : ${toRetry.length} film(s) retentes (RETRY_LIMIT=${RETRY_LIMIT === Infinity ? "aucune" : RETRY_LIMIT}).\n`);

  const facts = await loadFactsFromSupabase(
    toRetry.map(e => wikipediaByWikidataId.get(e.wikidata_id)).filter(Boolean).map(r => r.movie_id)
  );

  let newSuccesses = 0, stillFailed = 0;
  const levelCounts = { 1: 0, 2: 0, 3: 0 };
  const errorCounts = { invalid_json: 0, invalid_structure: 0, missing_fields: 0, wrong_schema: 0, invalid_types: 0, network_error: 0, needs_review: 0 };
  const remainingFailures = [];

  for (const entry of toRetry) {
    const r = wikipediaByWikidataId.get(entry.wikidata_id);
    if (!r) { console.log(`  IGNORE ${entry.title} — introuvable dans wikipedia-synopsis-1018.json`); stillFailed++; continue; }

    // Garde-fou explicite : un succes existant n'est JAMAIS ecrase par ce script (deja
    // garanti par le filtre plus haut, mais verifie une seconde fois ici par securite).
    if (cache[entry.wikidata_id] && cache[entry.wikidata_id].status === "success") {
      console.log(`  IGNORE ${entry.title} — deja un succes, ne sera jamais ecrase.`);
      continue;
    }

    const fact = facts.get(r.movie_id) || {};
    const data = r.lang_used === "fr" ? r.fr : r.en;
    const film = {
      title: r.title, year: fact.year, runtime_minutes: fact.runtime_minutes,
      countries: fact.countries || [], genres: fact.genres || [],
      directors: fact.directors || [], actors: fact.actors || [],
      intro_text: data ? data.intro : null,
      synopsis_text: data ? data.synopsis_text : null,
    };

    const result = await runWithFallback(film, { model: MODEL });
    const totalAttempts = result.attempts.length;

    if (result.status === "success") {
      const warnings = consistency.checkConsistency(result.profile);
      cache[entry.wikidata_id] = {
        wikidata_id: entry.wikidata_id, title: entry.title, year: fact.year,
        source: { wikipedia_language: r.lang_used, wikipedia_title: r.lang_used === "fr" ? r.wikipedia_title_fr : r.wikipedia_title_en, has_intro: Boolean(film.intro_text), has_synopsis: Boolean(film.synopsis_text) },
        facts: { genres: fact.genres, directors: fact.directors, actors: fact.actors, runtime_minutes: fact.runtime_minutes, countries: fact.countries },
        semantic_profile: result.profile,
        corrections: result.corrections || [], warnings,
        status: "success", recovered_via_fallback_level: result.level,
        attempts: (entry.attempts || 0) + totalAttempts,
      };
      newSuccesses++;
      levelCounts[result.level]++;
      console.log(`  RECUPERE  ${entry.title} — niveau ${result.level} (etait: ${entry.status})`);
    } else {
      cache[entry.wikidata_id] = {
        ...entry, status: "needs_review", fallback_history: result.attempts,
        attempts: (entry.attempts || 0) + totalAttempts,
      };
      stillFailed++;
      errorCounts.needs_review++;
      remainingFailures.push({ title: entry.title, wikidata_id: entry.wikidata_id, was: entry.status, now: "needs_review" });
      console.log(`  NEEDS_REVIEW ${entry.title} — les 3 niveaux ont echoue (etait: ${entry.status})`);
    }

    saveJsonAtomic(CACHE_PATH, cache); // sauvegarde apres chaque film
  }

  const successCountAfter = Object.values(cache).filter(e => e.status === "success").length;

  console.log(`\n=== RAPPORT RECUPERATION CIBLEE (cascade niveau 1 -> 2 -> 3 -> needs_review) ===`);
  console.log(`Succes avant retry     : ${successCountBefore}`);
  console.log(`Films retentes         : ${toRetry.length}`);
  console.log(`Nouveaux succes        : ${newSuccesses}`);
  console.log(`  dont niveau 1 (pipeline normal)      : ${levelCounts[1]}`);
  console.log(`  dont niveau 2 (contexte nettoye)     : ${levelCounts[2]}`);
  console.log(`  dont niveau 3 (synopsis minimal)     : ${levelCounts[3]}`);
  console.log(`Toujours en echec (needs_review) : ${stillFailed}`);
  console.log(`Succes apres retry     : ${successCountAfter}`);
  console.log(`Controle : ${successCountBefore} + ${newSuccesses} = ${successCountBefore + newSuccesses} ${successCountBefore + newSuccesses === successCountAfter ? "== succes apres retry (coherent)" : "!= INCOHERENCE A INVESTIGUER"}`);

  if (remainingFailures.length) {
    console.log(`\nFilms restant en needs_review (cette passe) :`);
    remainingFailures.forEach(f => console.log(`  - ${f.title} (${f.wikidata_id}) : etait ${f.was}`));
  }
  console.log(`\nAucune ecriture Supabase n'a ete faite.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run };