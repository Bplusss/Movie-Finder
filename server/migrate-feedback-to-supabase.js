#!/usr/bin/env node
// server/migrate-feedback-to-supabase.js
// node server/migrate-feedback-to-supabase.js [chemin optionnel vers feedback-log.json]
//
// Migration IDEMPOTENTE des anciens feedbacks locaux vers Supabase. Ne
// modifie JAMAIS pipeline/test-results/feedback-log.json (lecture seule).
// Conserve les timestamps, sessions, positions/scores originaux tels quels.
// Relancer ce script plusieurs fois ne cree jamais de doublons (contrainte
// unique (query, film_id, session_id, created_at) + ON CONFLICT DO NOTHING).
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DEFAULT_LOG_PATH = path.join(__dirname, "..", "pipeline", "test-results", "feedback-log.json");

function loadLog(p) {
  if (!fs.existsSync(p)) throw new Error(`Fichier introuvable : ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function migrate(logPath, pool) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL non definie -- impossible de migrer sans connexion Supabase");
  }
  const log = loadLog(logPath);
  let inserted = 0, skipped = 0, errors = 0;

  for (const entry of log) {
    try {
      const result = await pool.query(
        `insert into feedback
          (query, film_id, film_title, position, score, relevance_rating, film_rating, irrelevance_reasons, session_id, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         on conflict (query, film_id, session_id, created_at) do nothing
         returning id`,
        [
          entry.query, entry.filmId, entry.filmTitle || null, entry.position ?? null, entry.score ?? null,
          entry.relevanceRating ?? null, entry.filmRating ?? null,
          entry.irrelevanceReasons && entry.irrelevanceReasons.length ? entry.irrelevanceReasons : null,
          entry.sessionId || null,
          entry.timestamp || new Date().toISOString(),
        ]
      );
      if (result.rows.length > 0) inserted++; else skipped++;
    } catch (e) {
      errors++;
      console.error(`Erreur sur l'entree (query="${entry.query}", filmId="${entry.filmId}") : ${e.message}`);
    }
  }
  return { total: log.length, inserted, skipped, errors };
}

async function run() {
  const logPath = process.argv[2] || DEFAULT_LOG_PATH;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const stats = await migrate(logPath, pool);
    console.log(`Migration terminee.`);
    console.log(`  Total dans le fichier local : ${stats.total}`);
    console.log(`  Nouvellement inseres        : ${stats.inserted}`);
    console.log(`  Deja presents (ignores)     : ${stats.skipped}`);
    console.log(`  Erreurs                     : ${stats.errors}`);
    console.log(`\nRelancer ce script ne creera aucun doublon supplementaire (idempotent).`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { migrate, loadLog };
