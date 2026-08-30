#!/usr/bin/env node
// pipeline/enrich-llm.js
//
// Génère les champs propriétaires Movie Finder (moods, intensity, humor,
// romance, violence, complexity, feel_good, good_for, tags) à partir des
// données factuelles (titre, synopsis, genres, année, pays, casting).
//
// IMPORTANT (brief §5) : ce script tourne UNE FOIS par film, puis stocke le
// résultat. Il ne doit jamais être relancé sur tout le catalogue à chaque
// démarrage de l'app — seulement sur les films dont enrichment_status='pending'.
//
// Prérequis réels : export ANTHROPIC_API_KEY=...   puis   node pipeline/enrich-llm.js
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("./lib/db");

const INPUT_FILE = path.join(__dirname, "output-movies.jsonl");
const OUTPUT_FILE = path.join(__dirname, "output-enrichment.jsonl");
const BATCH_SIZE = 10;
const CONCURRENCY_DELAY_MS = 500;

const SYSTEM_PROMPT = `Tu reçois les données factuelles d'un film (titre, synopsis, genres, année,
pays, casting). Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour,
au format suivant (échelle 1 à 5) :
{
  "moods": ["funny"|"light"|"dark"|"feelgood"|"intense"|"cerebral"|"romantic"|"tense"|"uplifting"|"absurd", ...],
  "intensity": 1-5,
  "humor": 1-5,
  "romance": 1-5,
  "violence": 1-5,
  "complexity": 1-5,
  "feel_good": 1-5,
  "good_for": ["couple"|"friends"|"family"|"solo"|"evening", ...],
  "tags": ["quelques mots-clés libres"]
}
Base-toi uniquement sur les informations fournies. N'invente aucun fait sur le film.`;

function alreadyEnriched() {
  if (!fs.existsSync(OUTPUT_FILE)) return new Set();
  return new Set(
    fs.readFileSync(OUTPUT_FILE, "utf8").split("\n").filter(Boolean)
      .map(l => JSON.parse(l).wikidata_id)
  );
}

async function enrichOne(movie) {
  const userContent = `Titre: ${movie.title}
Année: ${movie.year || "inconnue"}
Pays: ${(movie.countries || []).join(", ") || "inconnu"}
Genres: ${(movie.genres || []).join(", ") || "inconnus"}
Casting: ${(movie.actors || []).slice(0, 5).join(", ") || "inconnu"}
Synopsis: ${movie.synopsis_raw || movie.synopsis || "non disponible"}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!resp.ok) throw new Error(`API HTTP ${resp.status}`);
  const data = await resp.json();
  const raw = data.content.map(b => b.text || "").join("").trim();
  const clean = raw.replace(/```json|```/g, "").trim();
  const enrichment = JSON.parse(clean);

  // 1-5 (contrat LLM, brief §5) -> 0-10 (échelle interne du moteur)
  const to10 = v => Math.round(v * 2);
  return {
    wikidata_id: movie.wikidata_id,
    moods: enrichment.moods || [],
    intensity: to10(enrichment.intensity || 3),
    humor: to10(enrichment.humor || 1),
    romance: to10(enrichment.romance || 1),
    violence: to10(enrichment.violence || 1),
    complexity: to10(enrichment.complexity || 3),
    feel_good: to10(enrichment.feel_good || 3),
    good_for: enrichment.good_for || [],
    tags: enrichment.tags || [],
    enrichment_status: "done",
  };
}

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY manquant — export ANTHROPIC_API_KEY=... avant de lancer ce script.");
  }

  let pending, done = new Set();
  if (db.isConfigured()) {
    pending = await db.getMoviesPendingLlmEnrichment();
  } else {
    const movies = fs.readFileSync(INPUT_FILE, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
    done = alreadyEnriched();
    pending = movies.filter(m => !done.has(m.wikidata_id));
  }

  console.log(`${pending.length} films à enrichir${db.isConfigured() ? " (depuis Postgres, enrichment_status='pending')" : ` (${done.size} déjà traités, reprise automatique via JSONL)`}.`);
  console.log(`⚠️  Coût réel estimé : ${pending.length} appels API Anthropic. Vérifie ta tarification avant de lancer sur un gros volume.`);

  let ok = 0, failed = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    for (const movie of batch) {
      try {
        const result = await enrichOne(movie);
        if (db.isConfigured()) {
          await db.applyLlmEnrichment(result);
        } else {
          fs.appendFileSync(OUTPUT_FILE, JSON.stringify(result) + "\n");
        }
        ok++;
      } catch (e) {
        failed++;
        console.warn(`Échec enrichissement ${movie.wikidata_id} (${movie.title}) : ${e.message}`);
      }
      await new Promise(r => setTimeout(r, CONCURRENCY_DELAY_MS));
    }
    console.log(`${ok + failed}/${pending.length} traités (${ok} ok, ${failed} échecs)`);
  }
  console.log(`\nEnrichissement terminé : ${ok} films enrichis, ${failed} échecs à relancer plus tard (relance : les films 'done' ne sont pas retraités).`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}

module.exports = { run, enrichOne };
