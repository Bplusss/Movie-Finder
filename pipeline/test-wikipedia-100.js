#!/usr/bin/env node
// pipeline/test-wikipedia-100.js
// npm run test:wikipedia-100
//
// POC : mesure la faisabilite de recuperer l'introduction Wikipedia de 100
// films deja en base, via l'API MediaWiki officielle ciblee (pas de dump,
// pas de DBpedia, pas de TMDB/IMDb). LECTURE SEULE sur Supabase.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const wiki = require("./lib/wikipedia-api");

const RESULTS_DIR = path.join(__dirname, "test-results");
const CACHE_PATH = path.join(RESULTS_DIR, "wikipedia-cache.json");
const REPORT_PATH = path.join(RESULTS_DIR, "wikipedia-100.json");
const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || "100", 10);
const DELAY_MS = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8")); }
  catch (e) { return {}; } // pas encore de cache -> normal au premier lancement
}
function saveCache(cache) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

async function withRetry(fn, label, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      const isRateLimit = e.status === 429 || e.status === 503;
      const wait = e.retryAfterMs || (isRateLimit ? 4000 * i : 1500 * i);
      console.warn(`  tentative ${i}/${attempts} echouee pour ${label} (${e.message})${isRateLimit ? ` - attente ${Math.round(wait / 1000)}s` : ""}`);
      if (i === attempts) throw e; // erreur reseau persistante -> remontee, JAMAIS traitee comme "pas de synopsis"
      await sleep(wait);
    }
  }
}

async function loadFilmsFromSupabase(limit) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquant.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Lecture seule : aucune ecriture n'est faite dans ce script.
  const { rows } = await pool.query(
    `select wikidata_id, title, wikipedia_title_en, year, runtime_minutes, genres, directors, actors
     from movies where wikidata_id is not null order by wikidata_id limit $1`,
    [limit]
  );
  await pool.end();
  return rows;
}

async function run() {
  console.log(`[POC Wikipedia] Chargement de ${SAMPLE_SIZE} films depuis Supabase (lecture seule)...`);
  const films = await loadFilmsFromSupabase(SAMPLE_SIZE);
  console.log(`${films.length} films charges.`);

  const cache = loadCache();
  const results = [];
  let fetchedThisRun = 0;

  for (const film of films) {
    const base = {
      wikidata_id: film.wikidata_id, title: film.title,
      wikipedia_title_en: film.wikipedia_title_en, wikipedia_url: null,
      wikipedia_found: false, intro_text: null, intro_length: 0,
      status: null, // 'ok' | 'not_found' | 'no_title' | 'network_error'
    };

    if (!film.wikipedia_title_en) {
      results.push({ ...base, status: "no_title" });
      continue;
    }

    if (cache[film.wikipedia_title_en]) {
      const c = cache[film.wikipedia_title_en];
      results.push({ ...base, ...c });
      continue;
    }

    try {
      const r = await withRetry(() => wiki.fetchIntro(film.wikipedia_title_en), `Wikipedia "${film.wikipedia_title_en}"`);
      const entry = r.found
        ? { wikipedia_url: r.wikipedia_url, wikipedia_found: true, intro_text: r.intro_text, intro_length: r.intro_text ? r.intro_text.length : 0, status: "ok" }
        : { wikipedia_url: null, wikipedia_found: false, intro_text: null, intro_length: 0, status: "not_found" };
      cache[film.wikipedia_title_en] = entry;
      saveCache(cache); // sauvegarde immediate -> une interruption ne perd rien
      results.push({ ...base, ...entry });
      fetchedThisRun++;
    } catch (e) {
      // Echec reseau persistant apres tentatives : JAMAIS mis en cache comme "absent",
      // pour qu'une relance retente reellement ce film plutot que d'abandonner.
      results.push({ ...base, status: "network_error" });
      console.warn(`  echec reseau definitif pour "${film.title}" (${film.wikipedia_title_en}) : ${e.message}`);
    }

    if (fetchedThisRun % 10 === 0 && fetchedThisRun > 0) {
      console.log(`  ${results.length}/${films.length} films traites (${fetchedThisRun} requetes reseau effectuees cette passe)`);
    }
    await sleep(DELAY_MS);
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2));

  // --- Rapport ---
  const total = results.length;
  const withTitle = results.filter(r => r.status !== "no_title").length;
  const found = results.filter(r => r.wikipedia_found).length;
  const withIntro = results.filter(r => r.wikipedia_found && r.intro_text).length;
  const notFound = results.filter(r => r.status === "not_found").length;
  const networkErrors = results.filter(r => r.status === "network_error").length;
  const noTitle = results.filter(r => r.status === "no_title").length;
  const avgLength = withIntro ? Math.round(results.filter(r => r.intro_text).reduce((a, r) => a + r.intro_length, 0) / withIntro) : 0;
  const successRate = Math.round((withIntro / total) * 1000) / 10;

  console.log(`\n=== RAPPORT (lecture seule, rien ecrit dans Supabase) ===`);
  console.log(`Films testes                 : ${total}`);
  console.log(`Avec wikipedia_title_en      : ${withTitle}`);
  console.log(`Articles trouves             : ${found}`);
  console.log(`Introductions recuperees     : ${withIntro}`);
  console.log(`  dont "article absent"      : ${notFound}`);
  console.log(`  dont "pas de titre en base" : ${noTitle}`);
  console.log(`  dont "echec reseau"        : ${networkErrors}  (a retenter, PAS des echecs definitifs)`);
  console.log(`Taux de reussite             : ${successRate}%`);
  console.log(`Longueur moyenne d'intro     : ${avgLength} caracteres`);

  console.log(`\n--- 20 exemples reussis ---`);
  results.filter(r => r.wikipedia_found).slice(0, 20).forEach(r => {
    console.log(`- ${r.title} (${r.wikidata_id}) - ${r.intro_length} caracteres`);
  });

  console.log(`\n--- 10 exemples d'echec (avec raison exacte) ---`);
  results.filter(r => !r.wikipedia_found).slice(0, 10).forEach(r => {
    console.log(`- ${r.title} (${r.wikidata_id}) - statut: ${r.status}`);
  });

  console.log(`\n=== TEST 2 : lisibilite metadonnees + introduction (20 films) ===`);
  results.filter(r => r.wikipedia_found).slice(0, 20).forEach(r => {
    const film = films.find(f => f.wikidata_id === r.wikidata_id);
    console.log(`\nFILM : ${r.title} (${film.year || "annee ?"})`);
    console.log(`  Genres      : ${(film.genres || []).join(", ") || "-"}`);
    console.log(`  Realisateur : ${(film.directors || []).join(", ") || "-"}`);
    console.log(`  Acteurs     : ${(film.actors || []).slice(0, 3).join(", ") || "-"}`);
    console.log(`  Intro       : ${r.intro_text.slice(0, 220)}${r.intro_text.length > 220 ? "..." : ""}`);
  });

  let verdict;
  if (withIntro >= 90) verdict = "FEASIBLE";
  else if (withIntro >= 70) verdict = "FEASIBLE MAIS IMPARFAIT";
  else verdict = "PROBLEMATIQUE";

  console.log(`\n=== CONCLUSION ===`);
  console.log(`${withIntro}/${total} introductions exploitables -> ${verdict}`);
  console.log(`\nResultats complets ecrits dans : pipeline/test-results/wikipedia-100.json`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
