// server/index.js
// API minimale servant le prototype Movie Finder depuis une vraie base Postgres.
// npm install express pg cors
// export DATABASE_URL=...
// node server/index.js   (écoute sur PORT, 3001 par défaut)
"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const engine = require("./engine");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL manquant. export DATABASE_URL=postgresql://... avant de lancer le serveur.");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

/* ---------- Cache en mémoire du catalogue (évite de tout recharger à chaque requête) ---------- */
let CACHE = { movies: [], statsByMovieId: new Map(), loadedAt: 0 };
const CACHE_TTL_MS = 60_000;

async function loadCache() {
  const { rows: movies } = await pool.query(`select * from movies`);
  const { rows: stats } = await pool.query(`
    select movie_id,
           avg(movie_quality_rating) as quality_avg, count(movie_quality_rating) as quality_count,
           avg(search_fit_rating) as fit_avg, count(search_fit_rating) as fit_count,
           count(*) filter (where search_fit_rating >= 4) as like_count
    from ratings group by movie_id
  `);
  const statsByMovieId = new Map();
  for (const s of stats) statsByMovieId.set(s.movie_id, s);
  CACHE = { movies, statsByMovieId, loadedAt: Date.now() };
  console.log(`Cache rechargé : ${movies.length} films, ${stats.length} films notés.`);
}

async function ensureCache() {
  if (Date.now() - CACHE.loadedAt > CACHE_TTL_MS) await loadCache();
}

async function ensureUser(userId) {
  await pool.query(`insert into users (id) values ($1) on conflict (id) do nothing`, [userId]);
}

/* ---------- Routes ---------- */

app.get("/api/health", async (req, res) => {
  try {
    await ensureCache();
    res.json({ ok: true, catalogSize: CACHE.movies.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/catalog/size", async (req, res) => {
  await ensureCache();
  res.json({ size: CACHE.movies.length });
});

app.post("/api/recommend", async (req, res) => {
  try {
    await ensureCache();
    const { parsed, query, userId, excludeIds = [], searchId: existingSearchId, n = 3 } = req.body;
    if (!userId || !parsed) return res.status(400).json({ error: "userId et parsed sont requis" });

    await ensureUser(userId);

    let searchId = existingSearchId;
    if (!searchId) {
      const { rows } = await pool.query(
        `insert into searches (user_id, query, parsed_query) values ($1,$2,$3) returning id`,
        [userId, query || "", JSON.stringify(parsed)]
      );
      searchId = rows[0].id;
    }

    const { rows: watchedRows } = await pool.query(
      `select movie_id from watch_history where user_id=$1`, [userId]
    );
    const watchedIds = new Set(watchedRows.map(r => r.movie_id));

    const { rows: profileRows } = await pool.query(
      `select mv.genres, mv.runtime_minutes, r.movie_quality_rating
       from ratings r join movies mv on mv.id = r.movie_id
       where r.user_id = $1`, [userId]
    );

    const results = engine.recommend({
      candidates: CACHE.movies,
      statsByMovieId: CACHE.statsByMovieId,
      profileRows,
      excludeIds: new Set(excludeIds),
      watchedIds,
      parsed,
      n,
    });

    res.json({ searchId, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/rating", async (req, res) => {
  try {
    const { userId, movieId, searchId, fitRating, qualityRating } = req.body;
    if (!userId || !movieId || !fitRating || !qualityRating) {
      return res.status(400).json({ error: "userId, movieId, fitRating, qualityRating sont requis" });
    }
    await ensureUser(userId);
    await pool.query(
      `insert into ratings (user_id, movie_id, search_id, search_fit_rating, movie_quality_rating)
       values ($1,$2,$3,$4,$5)
       on conflict (user_id, movie_id, search_id) do update set
         search_fit_rating=excluded.search_fit_rating, movie_quality_rating=excluded.movie_quality_rating`,
      [userId, movieId, searchId || null, fitRating, qualityRating]
    );
    await pool.query(
      `insert into watch_history (user_id, movie_id, search_id) values ($1,$2,$3)`,
      [userId, movieId, searchId || null]
    );
    // Invalide le cache de stats pour refléter la nouvelle note à la prochaine requête utile.
    CACHE.loadedAt = 0;
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/history/:userId", async (req, res) => {
  const { rows } = await pool.query(
    `select wh.watched_at, r.movie_quality_rating, r.search_fit_rating, mv.*
     from watch_history wh
     join movies mv on mv.id = wh.movie_id
     left join ratings r on r.movie_id = wh.movie_id and r.user_id = wh.user_id
     where wh.user_id = $1 order by wh.watched_at desc`,
    [req.params.userId]
  );
  res.json({ history: rows });
});

app.listen(PORT, () => console.log(`Movie Finder API sur http://localhost:${PORT}`));
