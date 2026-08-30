#!/usr/bin/env node
// pipeline/test-semantic-ollama-20.js
// npm run test:semantic-ollama-20
//
// POC : genere des profils semantiques pour 20 films varies via un modele
// Ollama LOCAL (aucune donnee envoyee a un service externe, aucun cout).
// LECTURE SEULE sur Supabase. N'ARRETE PAS avant 20 — pas de traitement
// des 1018 films a ce stade.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const ollama = require("./lib/ollama-client");
const semantic = require("./lib/semantic-profile-v2");
const { selectRepresentative } = require("./lib/select-representative");

const RESULTS_DIR = path.join(__dirname, "test-results");
const WIKIPEDIA_JSON_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const OUTPUT_JSON_PATH = path.join(RESULTS_DIR, "semantic-test-20.json");
const OUTPUT_READABLE_PATH = path.join(RESULTS_DIR, "semantic-test-20-readable.txt");
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct";
const SAMPLE_SIZE = 20;

function loadJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

async function loadFactsFromSupabase(movieIds) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquant.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Lecture seule : uniquement un SELECT, aucune ecriture nulle part dans ce script.
  const { rows } = await pool.query(
    `select id, wikidata_id, title, year, runtime_minutes, countries, genres, directors, actors
     from movies where id = any($1)`,
    [movieIds]
  );
  await pool.end();
  return new Map(rows.map(r => [r.id, r]));
}

async function generateWithRetry(film, attempts = 2) {
  let lastError, lastErrorType = "network_error", lastRawResponse = null, lastCorrections = [];
  for (let i = 1; i <= attempts; i++) {
    const start = Date.now();
    try {
      const raw = await ollama.generate({
        model: MODEL,
        systemPrompt: semantic.SYSTEM_PROMPT,
        userPrompt: semantic.buildPrompt(film),
      });
      const elapsedMs = Date.now() - start;
      console.log(`DEBUG — reponse brute Ollama pour "${film.title}" :\n${raw}\n`);
      const validation = semantic.parseAndValidate(raw, { debug: true });
      lastRawResponse = validation.rawResponse;
      lastCorrections = validation.corrections || [];
      if (validation.valid) return { ...validation, elapsedMs, attempts: i };
      lastError = validation.error;
      lastErrorType = validation.errorType;
      console.warn(`  reponse invalide (tentative ${i}/${attempts}) pour "${film.title}" [${validation.errorType}] : ${validation.error}`);
    } catch (e) {
      lastError = e.message;
      lastErrorType = "network_error";
      console.warn(`  erreur Ollama (tentative ${i}/${attempts}) pour "${film.title}" : ${e.message}`);
    }
  }
  return { valid: false, error: lastError, errorType: lastErrorType, attempts, rawResponse: lastRawResponse, corrections: lastCorrections };
}

async function run() {
  console.log(`[POC Ollama — 20 films] Verification qu'Ollama tourne...`);
  const status = await ollama.checkOllamaRunning();
  if (!status.running) {
    throw new Error(`Ollama ne repond pas sur ${ollama.BASE_URL}. Verifie qu'Ollama est bien lance (ouvre l'application Ollama), puis relance.`);
  }
  console.log(`Ollama actif. Modeles installes : ${status.models.join(", ") || "aucun"}`);
  if (!status.models.some(m => m.startsWith(MODEL.split(":")[0]))) {
    throw new Error(`Le modele "${MODEL}" ne semble pas installe. Lance d'abord : ollama pull ${MODEL}`);
  }

  const wikipediaResults = loadJson(WIKIPEDIA_JSON_PATH);
  const withContent = wikipediaResults.filter(r => r.intro_available || r.synopsis_available);
  console.log(`${withContent.length} films disponibles avec du contenu Wikipedia.`);

  const facts = await loadFactsFromSupabase(withContent.map(r => r.movie_id));
  console.log(`Faits Wikidata charges pour ${facts.size} films (lecture seule).`);

  const candidatesWithGenres = withContent.map(r => ({
    ...r, year: (facts.get(r.movie_id) || {}).year, genres: (facts.get(r.movie_id) || {}).genres || [],
  }));
  const selected = selectRepresentative(candidatesWithGenres, SAMPLE_SIZE);
  console.log(`${selected.length} films selectionnes, delibrement varies :`);
  selected.forEach(f => console.log(`  - ${f.title} (${f.year || "?"}) [${(f.genres || []).join(", ") || "genre inconnu"}]`));

  console.log(`\nGeneration des profils via Ollama (${MODEL})...\n`);
  const results = [];
  let ok = 0, retried = 0, totalNulls = 0, totalMs = 0;
  let filmsWithCorrections = 0, totalCorrections = 0;
  const errorCounts = { invalid_json: 0, invalid_structure: 0, missing_fields: 0, invalid_types: 0, network_error: 0 };

  for (const r of selected) {
    const fact = facts.get(r.movie_id) || {};
    const data = r.lang_used === "fr" ? r.fr : r.en;
    const film = {
      title: r.title, year: fact.year, runtime_minutes: fact.runtime_minutes,
      countries: fact.countries || [], genres: fact.genres || [],
      directors: fact.directors || [], actors: fact.actors || [],
      intro_text: data ? data.intro : null,
      synopsis_text: data ? data.synopsis_text : null,
    };

    const gen = await generateWithRetry(film);
    if (gen.attempts > 1) retried++;
    if (gen.corrections && gen.corrections.length) { filmsWithCorrections++; totalCorrections += gen.corrections.length; }

    if (gen.valid) {
      ok++;
      totalMs += gen.elapsedMs;
      const nulls = semantic.countNulls(gen.profile);
      totalNulls += nulls;
      results.push({
        wikidata_id: r.wikidata_id, title: r.title, year: fact.year,
        source: { wikipedia_language: r.lang_used, wikipedia_title: r.lang_used === "fr" ? r.wikipedia_title_fr : r.wikipedia_title_en, has_intro: Boolean(film.intro_text), has_synopsis: Boolean(film.synopsis_text) },
        facts: { genres: fact.genres, directors: fact.directors, actors: fact.actors, runtime_minutes: fact.runtime_minutes, countries: fact.countries },
        semantic_profile: gen.profile,
        generation_time_ms: gen.elapsedMs, null_count: nulls, retried: gen.attempts > 1,
        corrections: gen.corrections || [], raw_response: gen.rawResponse,
        status: "ok",
      });
      const corrNote = gen.corrections && gen.corrections.length ? ` (${gen.corrections.length} correction(s) mecanique(s) : ${gen.corrections.join(", ")})` : "";
      console.log(`  OK   ${r.title} — ${(gen.elapsedMs / 1000).toFixed(1)}s — ${nulls} null(s) explicite(s)${gen.attempts > 1 ? " (retente)" : ""}${corrNote}`);
    } else {
      errorCounts[gen.errorType] = (errorCounts[gen.errorType] || 0) + 1;
      results.push({ wikidata_id: r.wikidata_id, title: r.title, status: "failed", error_type: gen.errorType, error: gen.error, raw_response: gen.rawResponse });
      console.log(`  ECHEC ${r.title} — [${gen.errorType}] ${gen.error}`);
    }
  }

  fs.writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(results, null, 2));

  // --- Fichier lisible ---
  const fmtArr = v => v === null ? "null (indéterminé)" : (v.join(", ") || "—");
  const readable = results.filter(r => r.status === "ok").map(r => {
    const p = r.semantic_profile;
    const fmt = v => v === null ? "null" : `${v}/10`;
    return `FILM : ${r.title} (${r.year || "?"})
Genres Wikidata : ${(r.facts.genres || []).join(", ") || "—"}
Tone : ${fmtArr(p.tone)}
Moods : ${fmtArr(p.moods)}
Themes : ${fmtArr(p.themes)}
Keywords : ${fmtArr(p.keywords)}
Good for : ${fmtArr(p.good_for)}
Humor: ${fmt(p.humor)}  Action: ${fmt(p.action)}  Violence: ${fmt(p.violence)}  Tension: ${fmt(p.tension)}
Romance: ${fmt(p.romance)}  Emotional: ${fmt(p.emotional)}  Complexity: ${fmt(p.complexity)}
Feel-good: ${fmt(p.feel_good)}  Darkness: ${fmt(p.darkness)}  Family-friendly: ${fmt(p.family_friendly)}
Temps de generation : ${(r.generation_time_ms / 1000).toFixed(1)}s${r.retried ? " (retente)" : ""} — ${r.null_count} null(s)${r.corrections.length ? ` — ${r.corrections.length} correction(s) mecanique(s) (${r.corrections.join(", ")})` : ""}
`;
  }).join("\n" + "=".repeat(60) + "\n\n");
  fs.writeFileSync(OUTPUT_READABLE_PATH, readable);

  // --- Detection GPU ---
  const gpu = await ollama.checkGpuUsage();

  // --- Rapport ---
  const avgMs = ok ? Math.round(totalMs / ok) : 0;
  const avgNulls = ok ? Math.round((totalNulls / ok) * 10) / 10 : 0;
  const estimated1018Hours = ok ? Math.round((avgMs * 1018 / 1000 / 3600) * 10) / 10 : null;

  console.log(`\n=== RAPPORT — POC 20 FILMS (Ollama local, aucun cout) ===`);
  console.log(`Modele utilise         : ${MODEL}`);
  console.log(`GPU Nvidia utilise     : ${gpu.checked ? (gpu.using_gpu ? `OUI (${Math.round(gpu.size_vram / 1e6)} Mo VRAM)` : "NON (tourne sur CPU)") : "impossible a verifier"}`);
  const totalFailed = selected.length - ok;
  console.log(`\nProfils valides                      : ${ok}/${selected.length}`);
  console.log(`Profils invalides — JSON invalide     : ${errorCounts.invalid_json}`);
  console.log(`Profils invalides — structure incorrecte (pas un objet) : ${errorCounts.invalid_structure}`);
  console.log(`Profils invalides — champs manquants : ${errorCounts.missing_fields}`);
  console.log(`Profils invalides — types incorrects  : ${errorCounts.invalid_types}`);
  console.log(`Erreurs Ollama / reseau               : ${errorCounts.network_error}`);
  console.log(`Total invalides (toutes causes)       : ${totalFailed}/${selected.length}`);
  console.log(`\nReponses ayant necessite une retentative : ${retried}`);
  console.log(`Films ayant necessite une correction mecanique (chaine -> tableau) : ${filmsWithCorrections}/${ok}`);
  console.log(`Nombre total de corrections mecaniques effectuees : ${totalCorrections}`);
  console.log(`\nNombre total de null EXPLICITES (scores + tableaux, profils valides uniquement) : ${totalNulls}`);
  console.log(`Moyenne de null explicites par profil valide : ${avgNulls}/15 champs possibles (10 scores + 5 tableaux)`);
  console.log(`\nTemps moyen par film (profils valides) : ${(avgMs / 1000).toFixed(1)}s`);
  console.log(`Temps total (20 films) : ${(totalMs / 1000).toFixed(0)}s`);
  console.log(`Estimation pour 1018 films : ~${estimated1018Hours}h (indicatif, dependant de la charge machine)`);

  console.log(`\nFichiers ecrits :`);
  console.log(`  pipeline/test-results/semantic-test-20.json (donnees completes)`);
  console.log(`  pipeline/test-results/semantic-test-20-readable.txt (lecture facile)`);
  console.log(`\nArret volontaire apres 20 films, comme demande. AUCUN traitement des 1018 films n'a ete lance.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run };
