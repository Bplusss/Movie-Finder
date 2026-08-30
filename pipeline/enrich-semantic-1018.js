#!/usr/bin/env node
// pipeline/enrich-semantic-1018.js
// npm run enrich:semantic-1018
//
// Traitement a pleine echelle, robuste aux interruptions :
//   - cache persistant, cle = wikidata_id (identifiant stable)
//   - sauvegarde APRES CHAQUE FILM, ecriture atomique (jamais de fichier a moitie ecrit)
//   - relancer la commande reprend exactement ou ca s'est arrete
//   - retry automatique borne (evite une boucle infinie sur un film qui echoue systematiquement)
//   - LECTURE SEULE sur Supabase — aucune ecriture nulle part dans ce script
//
// Variables :
//   SEMANTIC_LIMIT=5          limite le nombre de films traites CETTE PASSE (mini-test)
//   SEMANTIC_MAX_ATTEMPTS=3   tentatives cumulees max par film avant abandon (across runs)
//   SEMANTIC_ATTEMPTS_PER_FILM=2  tentatives internes par appel de generation (2 par defaut, monter a 3 pour un retry cible)
//   SEMANTIC_FORCE_RETRY=1    force une nouvelle tentative meme sur un echec deja "definitif"
//   SEMANTIC_DEBUG=1          reactive les logs de diagnostic verbeux (reponse brute a chaque appel)
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const ollama = require("./lib/ollama-client");
const semantic = require("./lib/semantic-profile-v2");
const consistency = require("./lib/consistency-checks");

const RESULTS_DIR = path.join(__dirname, "test-results");
const WIKIPEDIA_JSON_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const CACHE_PATH = path.join(RESULTS_DIR, "semantic-cache-1018.json");
const OUTPUT_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018.json");

const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b-instruct";
const LIMIT = process.env.SEMANTIC_LIMIT ? parseInt(process.env.SEMANTIC_LIMIT, 10) : Infinity;
const MAX_ATTEMPTS = parseInt(process.env.SEMANTIC_MAX_ATTEMPTS || "3", 10);
const ATTEMPTS_PER_CALL = parseInt(process.env.SEMANTIC_ATTEMPTS_PER_FILM || "2", 10);
const FORCE_RETRY = process.env.SEMANTIC_FORCE_RETRY === "1";
const DEBUG = process.env.SEMANTIC_DEBUG === "1";

function loadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { return fallback; }
}

/** Ecriture ATOMIQUE : ecrit dans un fichier temporaire puis renomme — jamais
 * de fichier de cache corrompu/tronque, meme si le process est tue en plein milieu. */
function saveJsonAtomic(p, obj) {
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, p);
}

async function loadFactsFromSupabase(movieIds) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquant.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Lecture seule : UNIQUEMENT un SELECT. Aucun INSERT/UPDATE/DELETE/ALTER nulle part dans ce script.
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
      const raw = await ollama.generate({ model: MODEL, systemPrompt: semantic.SYSTEM_PROMPT, userPrompt: semantic.buildPrompt(film) });
      const elapsedMs = Date.now() - start;
      if (DEBUG) console.log(`DEBUG — reponse brute Ollama pour "${film.title}" :\n${raw}\n`);
      const validation = semantic.parseAndValidate(raw, { debug: DEBUG });
      lastRawResponse = validation.rawResponse;
      lastCorrections = validation.corrections || [];
      if (validation.valid) return { ...validation, elapsedMs, attempts: i };
      lastError = validation.error;
      lastErrorType = validation.errorType;
      if (DEBUG) console.warn(`  reponse invalide (tentative ${i}/${attempts}) [${validation.errorType}] : ${validation.error}`);
    } catch (e) {
      lastError = e.message;
      lastErrorType = "network_error";
    }
  }
  return { valid: false, error: lastError, errorType: lastErrorType, attempts, rawResponse: lastRawResponse, corrections: lastCorrections };
}

function fmtEta(msRemaining) {
  const s = Math.round(msRemaining / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}min`;
  return `${Math.round(m / 60 * 10) / 10}h`;
}

async function run() {
  console.log(`[Enrichissement semantique — pleine echelle] Verification qu'Ollama tourne...`);
  const status = await ollama.checkOllamaRunning();
  if (!status.running) throw new Error(`Ollama ne repond pas sur ${ollama.BASE_URL}. Lance/ouvre Ollama, puis relance.`);
  if (!status.models.some(m => m.startsWith(MODEL.split(":")[0]))) throw new Error(`Modele "${MODEL}" non installe. Lance : ollama pull ${MODEL}`);
  console.log(`Ollama actif (${MODEL}).`);

  const wikipediaResults = loadJson(WIKIPEDIA_JSON_PATH, null);
  if (!wikipediaResults) throw new Error(`${WIKIPEDIA_JSON_PATH} introuvable — lance d'abord npm run test:wikipedia-synopsis.`);
  const films = LIMIT === Infinity ? wikipediaResults : wikipediaResults.slice(0, LIMIT);
  console.log(`${films.length} film(s) dans le lot a traiter${LIMIT !== Infinity ? ` (SEMANTIC_LIMIT=${LIMIT}, mode test)` : ""}.`);

  const facts = await loadFactsFromSupabase(films.map(r => r.movie_id));
  console.log(`Faits Wikidata charges pour ${facts.size} films (lecture seule — aucune ecriture Supabase dans ce script).`);

  const cache = loadJson(CACHE_PATH, {});
  const cacheEntriesCount = Object.keys(cache).length;
  const alreadySuccess = Object.values(cache).filter(c => c.status === "success").length;
  console.log(`Cache existant (${CACHE_PATH}) : ${cacheEntriesCount} entree(s), dont ${alreadySuccess} succes deja acquis.`);

  let processedThisRun = 0, skippedCached = 0, skippedPermanent = 0;
  let sumMsThisRun = 0;

  for (const r of films) {
    const existing = cache[r.wikidata_id];

    if (existing && existing.status === "success") { skippedCached++; continue; }
    if (existing && (existing.attempts || 0) >= MAX_ATTEMPTS && !FORCE_RETRY) { skippedPermanent++; continue; }

    const fact = facts.get(r.movie_id) || {};
    const data = r.lang_used === "fr" ? r.fr : r.en;
    const film = {
      title: r.title, year: fact.year, runtime_minutes: fact.runtime_minutes,
      countries: fact.countries || [], genres: fact.genres || [],
      directors: fact.directors || [], actors: fact.actors || [],
      intro_text: data ? data.intro : null,
      synopsis_text: data ? data.synopsis_text : null,
    };

    const gen = await generateWithRetry(film, ATTEMPTS_PER_CALL);
    const prevAttempts = existing ? (existing.attempts || 0) : 0;

    let entry;
    if (gen.valid) {
      const warnings = consistency.checkConsistency(gen.profile);
      entry = {
        wikidata_id: r.wikidata_id, title: r.title, year: fact.year,
        source: { wikipedia_language: r.lang_used, wikipedia_title: r.lang_used === "fr" ? r.wikipedia_title_fr : r.wikipedia_title_en, has_intro: Boolean(film.intro_text), has_synopsis: Boolean(film.synopsis_text) },
        facts: { genres: fact.genres, directors: fact.directors, actors: fact.actors, runtime_minutes: fact.runtime_minutes, countries: fact.countries },
        semantic_profile: gen.profile,
        generation_time_ms: gen.elapsedMs, corrections: gen.corrections || [], warnings,
        status: "success", attempts: prevAttempts + gen.attempts,
      };
      sumMsThisRun += gen.elapsedMs;
      const warnNote = warnings.length ? ` — ⚠️ ${warnings.length} WARNING(s)` : "";
      console.log(`  OK   ${r.title} — ${(gen.elapsedMs / 1000).toFixed(1)}s${warnNote}`);
    } else {
      entry = {
        wikidata_id: r.wikidata_id, title: r.title, status: gen.errorType || "failed",
        error: gen.error, raw_response: gen.rawResponse, attempts: prevAttempts + gen.attempts,
      };
      const givingUp = entry.attempts >= MAX_ATTEMPTS ? " (abandon definitif — max tentatives atteint)" : " (retente au prochain lancement)";
      console.log(`  ECHEC ${r.title} — [${entry.status}]${givingUp}`);
    }

    cache[r.wikidata_id] = entry;
    saveJsonAtomic(CACHE_PATH, cache); // sauvegarde APRES CE FILM — rien n'est perdu si interruption ici
    processedThisRun++;

    if (processedThisRun % 10 === 0) {
      const avgMs = sumMsThisRun / Math.max(1, processedThisRun);
      const remaining = films.length - skippedCached - skippedPermanent - processedThisRun;
      const eta = fmtEta(avgMs * remaining);
      console.log(`  --- ${processedThisRun} traites cette passe, ${skippedCached} deja en cache, ETA restant estime: ${eta} ---`);
    }
  }

  // --- Construit la sortie finale a partir de l'ETAT COMPLET du cache (cumulatif, pas juste cette passe) ---
  const allEntries = films.map(r => cache[r.wikidata_id]).filter(Boolean);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allEntries, null, 2));

  const successes = allEntries.filter(e => e.status === "success");
  const errorCounts = { invalid_json: 0, invalid_structure: 0, missing_fields: 0, wrong_schema: 0, invalid_types: 0, network_error: 0, failed: 0 };
  allEntries.filter(e => e.status !== "success").forEach(e => { errorCounts[e.status] = (errorCounts[e.status] || 0) + 1; });

  const totalCorrections = successes.reduce((a, e) => a + (e.corrections ? e.corrections.length : 0), 0);
  const filmsWithCorrections = successes.filter(e => e.corrections && e.corrections.length).length;
  const totalWarnings = successes.reduce((a, e) => a + (e.warnings ? e.warnings.length : 0), 0);
  const totalNulls = successes.reduce((a, e) => a + semantic.countNulls(e.semantic_profile), 0);
  const avgNulls = successes.length ? Math.round((totalNulls / successes.length) * 10) / 10 : 0;
  const avgMsAll = successes.length ? Math.round(successes.reduce((a, e) => a + e.generation_time_ms, 0) / successes.length) : 0;

  const gpu = await ollama.checkGpuUsage();

  console.log(`\n=== RAPPORT — ${allEntries.length}/${films.length} films traites au total (cumulatif, cache inclus) ===`);
  console.log(`Modele utilise      : ${MODEL}`);
  console.log(`GPU Nvidia utilise  : ${gpu.checked ? (gpu.using_gpu ? `OUI (${Math.round(gpu.size_vram / 1e6)} Mo VRAM)` : "NON (CPU)") : "impossible a verifier"}`);
  console.log(`\nCette passe : ${processedThisRun} traites, ${skippedCached} deja en cache (succes), ${skippedPermanent} abandon(s) definitif(s) ignores`);
  console.log(`\nProfils generes avec succes : ${successes.length}/${films.length}`);
  console.log(`Echecs — JSON invalide       : ${errorCounts.invalid_json}`);
  console.log(`Echecs — structure incorrecte: ${errorCounts.invalid_structure}`);
  console.log(`Echecs — champs manquants    : ${errorCounts.missing_fields}`);
  console.log(`Echecs — format completement different (wrong_schema) : ${errorCounts.wrong_schema}`);
  console.log(`Echecs — types incorrects    : ${errorCounts.invalid_types}`);
  console.log(`Echecs — reseau/Ollama       : ${errorCounts.network_error}`);
  console.log(`\nCorrections mecaniques string->tableau : ${totalCorrections} (sur ${filmsWithCorrections} films)`);
  console.log(`Null explicites au total : ${totalNulls} — moyenne ${avgNulls}/15 par profil`);
  console.log(`Warnings de coherence : ${totalWarnings} (signales, jamais corriges automatiquement)`);
  console.log(`\nTemps moyen par film (succes) : ${(avgMsAll / 1000).toFixed(1)}s`);
  console.log(`Temps de cette passe : ${(sumMsThisRun / 1000 / 60).toFixed(1)} min`);

  console.log(`\nRepartition des null par champ (sur les profils reussis) :`);
  for (const field of semantic.ALL_FIELDS) {
    const nullCount = successes.filter(e => e.semantic_profile[field] === null).length;
    const pct = successes.length ? Math.round((nullCount / successes.length) * 1000) / 10 : 0;
    console.log(`  ${field.padEnd(16)}: ${pct}% null`);
  }

  if (totalWarnings > 0) {
    console.log(`\nExemples de WARNING de coherence (signales, non corriges) :`);
    successes.filter(e => e.warnings && e.warnings.length).slice(0, 10).forEach(e => {
      e.warnings.forEach(w => console.log(`  ⚠️  ${e.title} : ${w}`));
    });
  }

  console.log(`\n⚠️  RAPPEL : le champ "good_for" est EXPERIMENTAL et non fiable pour le filtrage (cf. audit du 27/08) — conserve dans les profils mais a ne pas utiliser comme critere de recherche pour l'instant.`);
  console.log(`\nFichiers :`);
  console.log(`  ${CACHE_PATH} (cache cumulatif, relancer la commande reprend ici)`);
  console.log(`  ${OUTPUT_PATH} (export complet, ordonne comme wikipedia-synopsis-1018.json)`);
  console.log(`\nAucune ecriture Supabase n'a ete faite. Aucun INSERT/UPDATE/DELETE/ALTER.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run };
