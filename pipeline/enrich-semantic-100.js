#!/usr/bin/env node
// pipeline/enrich-semantic-100.js
// npm run enrich:semantic-100
//
// Genere un profil semantique (moods/themes/tags + 11 scores + confidence +
// data_quality) pour 100 films, via un VRAI appel LLM par film. LECTURE
// SEULE sur Supabase (uniquement un SELECT). Aucune ecriture, aucun nouveau
// synopsis genere — uniquement une analyse structuree du texte existant.
//
// Prerequis : export ANTHROPIC_API_KEY=...
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const semantic = require("./lib/semantic-profile");

const RESULTS_DIR = path.join(__dirname, "test-results");
const WIKIPEDIA_JSON_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const CACHE_PATH = path.join(RESULTS_DIR, "semantic-cache.json");
const OUTPUT_PATH = path.join(RESULTS_DIR, "semantic-enrichment-100.json");
const SAMPLE_SIZE = parseInt(process.env.SEMANTIC_SAMPLE || "100", 10);
const DELAY_MS = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } }
function saveJson(p, obj) { fs.mkdirSync(RESULTS_DIR, { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

async function withRetry(fn, label, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      console.warn(`  tentative ${i}/${attempts} echouee pour ${label} (${e.message})`);
      if (i === attempts) throw e;
      await sleep(2000 * i);
    }
  }
}

async function callLlm(film) {
  const userContent = semantic.buildPrompt(film);
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system: semantic.SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!resp.ok) { const err = new Error(`API HTTP ${resp.status}`); err.status = resp.status; throw err; }
  const data = await resp.json();
  const rawText = data.content.map(b => b.text || "").join("");
  return semantic.parseAndValidate(rawText);
}

/** Selectionne les 100 premiers films (par wikidata_id) ayant intro et/ou synopsis disponible. */
function selectFilms(wikipediaResults, limit) {
  return wikipediaResults
    .filter(r => r.intro_available || r.synopsis_available)
    .sort((a, b) => (a.wikidata_id > b.wikidata_id ? 1 : -1))
    .slice(0, limit);
}

async function loadFactsFromSupabase(movieIds) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquant.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Lecture seule : uniquement un SELECT, aucune ecriture.
  const { rows } = await pool.query(
    `select id, wikidata_id, title, year, runtime_minutes, countries, genres, directors, actors
     from movies where id = any($1)`,
    [movieIds]
  );
  await pool.end();
  return new Map(rows.map(r => [r.id, r]));
}

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY manquant — export ANTHROPIC_API_KEY=... avant de lancer ce script.");
  }
  const wikipediaResults = loadJson(WIKIPEDIA_JSON_PATH);
  if (!wikipediaResults) {
    throw new Error(`${WIKIPEDIA_JSON_PATH} introuvable — lance d'abord "npm run test:wikipedia-synopsis".`);
  }

  const selected = selectFilms(wikipediaResults, SAMPLE_SIZE);
  console.log(`${selected.length} films selectionnes (avec intro et/ou synopsis Wikipedia).`);

  const facts = await loadFactsFromSupabase(selected.map(r => r.movie_id));
  console.log(`Faits Wikidata charges pour ${facts.size} films (lecture seule).`);

  const cache = loadJson(CACHE_PATH) || {};
  const results = [];
  let generated = 0, failed = 0, skippedCached = 0;

  for (const r of selected) {
    if (cache[r.wikidata_id]) { results.push(cache[r.wikidata_id]); skippedCached++; continue; }

    const fact = facts.get(r.movie_id) || {};
    const data = r.lang_used === "fr" ? r.fr : r.en;
    const film = {
      title: r.title, year: fact.year, runtime_minutes: fact.runtime_minutes,
      countries: fact.countries || [], genres: fact.genres || [],
      directors: fact.directors || [], actors: fact.actors || [],
      intro_text: data ? data.intro : null,
      synopsis_text: data ? data.synopsis_text : null,
    };

    let entry;
    try {
      const validation = await withRetry(() => callLlm(film), `LLM "${r.title}"`);
      if (!validation.valid) {
        failed++;
        entry = { movie_id: r.movie_id, wikidata_id: r.wikidata_id, title: r.title, status: "invalid_response", error: validation.error };
        console.warn(`  echec validation pour "${r.title}" : ${validation.error}`);
      } else {
        generated++;
        entry = {
          movie_id: r.movie_id, wikidata_id: r.wikidata_id, title: r.title,
          source: {
            wikipedia_language: r.lang_used, wikipedia_title: r.lang_used === "fr" ? r.wikipedia_title_fr : r.wikipedia_title_en,
            has_intro: Boolean(film.intro_text), has_synopsis: Boolean(film.synopsis_text),
          },
          facts: { year: fact.year, runtime_minutes: fact.runtime_minutes, countries: fact.countries, genres: fact.genres, directors: fact.directors, actors: fact.actors },
          semantic_profile: validation.profile,
          confidence: validation.confidence,
          data_quality: validation.data_quality,
          status: "ok",
        };
      }
    } catch (e) {
      failed++;
      entry = { movie_id: r.movie_id, wikidata_id: r.wikidata_id, title: r.title, status: "network_error", error: e.message };
    }

    cache[r.wikidata_id] = entry;
    saveJson(CACHE_PATH, cache);
    results.push(entry);

    if ((generated + failed) % 10 === 0) console.log(`  ${generated + failed}/${selected.length - skippedCached} traites cette passe (${generated} ok, ${failed} echecs)`);
    await sleep(DELAY_MS);
  }

  saveJson(OUTPUT_PATH, results);

  console.log(`\n=== GENERATION TERMINEE ===`);
  console.log(`Profils generes : ${generated}`);
  console.log(`Deja en cache   : ${skippedCached}`);
  console.log(`Echecs          : ${failed}`);
  console.log(`\nResultats ecrits dans : pipeline/test-results/semantic-enrichment-100.json`);
  console.log(`Lance maintenant : npm run report:semantic-100`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run, selectFilms };
