// server/feedback-store-supabase.js
// Ecriture du feedback dans Supabase — UNIQUEMENT dans la table `feedback`
// (voir pipeline/feedback-schema.sql), jamais dans la table `movies`
// existante. N'ecrit que si DATABASE_URL est definie ; sinon, no-op
// silencieux (permet de continuer a tourner en local sans Supabase).
"use strict";
const { Pool } = require("pg");

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

/** Insere UNE ligne de feedback. Ne leve jamais d'exception vers l'appelant —
 * renvoie {ok, error} pour que le serveur decide comment reagir (jamais un
 * crash de la requete utilisateur a cause d'un souci de base de donnees). */
async function saveFeedbackToSupabase(entry) {
  const p = getPool();
  if (!p) return { ok: false, error: "DATABASE_URL non definie -- Supabase desactive" };

  try {
    await p.query(
      `insert into feedback
        (query, film_id, film_title, position, score, relevance_rating, film_rating, irrelevance_reasons, session_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.query, entry.filmId, entry.filmTitle || null, entry.position ?? null, entry.score ?? null,
        entry.relevanceRating ?? null, entry.filmRating ?? null,
        entry.irrelevanceReasons && entry.irrelevanceReasons.length ? entry.irrelevanceReasons : null,
        entry.sessionId || null,
      ]
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { saveFeedbackToSupabase, getPool };
