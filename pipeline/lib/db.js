// pipeline/lib/db.js
// Adaptateur PostgreSQL réel (utilisé quand DATABASE_URL est défini).
// Nécessite : npm install pg
"use strict";
const { Pool } = require("pg");

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

/** Upsert idempotent d'un lot de films Wikidata, clé = wikidata_id. */
async function upsertWikidataMovies(rows) {
  const p = getPool();
  let ok = 0, failed = [];
  for (const row of rows) {
    try {
      await p.query(
        `insert into movies
           (wikidata_id, title, year, release_date, runtime_minutes,
            countries, languages, genres, directors, actors, external_ids)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         on conflict (wikidata_id) do update set
           title=excluded.title, year=excluded.year, release_date=excluded.release_date,
           runtime_minutes=excluded.runtime_minutes, countries=excluded.countries,
           genres=excluded.genres, directors=excluded.directors, actors=excluded.actors,
           external_ids=excluded.external_ids, updated_at=now()`,
        [row.wikidata_id, row.title, row.year, row.release_date, row.runtime_minutes,
         row.countries, row.languages, row.genres, row.directors, row.actors,
         JSON.stringify(row.external_ids || {})]
      );
      ok++;
    } catch (e) {
      failed.push({ wikidata_id: row.wikidata_id, reason: e.message });
    }
  }
  return { ok, failed };
}

/** Récupère les films n'ayant pas encore de dbpedia_uri (candidats à l'enrichissement). */
async function getMoviesNeedingDbpedia(limit = 5000) {
  const p = getPool();
  const { rows } = await p.query(
    `select wikidata_id, title, year from movies where dbpedia_uri is null limit $1`,
    [limit]
  );
  return rows;
}

/** Applique l'enrichissement DBpedia (synopsis brut, catégories) sur une ligne existante. */
async function applyDbpediaEnrichment(rec) {
  const p = getPool();
  await p.query(
    `update movies set dbpedia_uri=$2, synopsis_raw=$3, synopsis_source_license=$4, updated_at=now()
     where wikidata_id=$1`,
    [rec.wikidata_id, rec.dbpedia_uri, rec.synopsis_raw, rec.synopsis_source_license]
  );
}

/** Films en attente d'enrichissement Movie Finder (moods/intensity/...). */
async function getMoviesPendingLlmEnrichment(limit = 10000) {
  const p = getPool();
  const { rows } = await p.query(
    `select wikidata_id, title, year, countries, genres, actors, synopsis_raw, synopsis
     from movies where enrichment_status='pending' limit $1`,
    [limit]
  );
  return rows;
}

async function applyLlmEnrichment(rec) {
  const p = getPool();
  await p.query(
    `update movies set moods=$2, intensity=$3, humor=$4, romance=$5, violence=$6,
       complexity=$7, feel_good=$8, good_for=$9, tags=$10, enrichment_status='done', updated_at=now()
     where wikidata_id=$1`,
    [rec.wikidata_id, rec.moods, rec.intensity, rec.humor, rec.romance, rec.violence,
     rec.complexity, rec.feel_good, rec.good_for, rec.tags]
  );
}

/** Upsert idempotent d'un lot de films TMDB, clé = tmdb_id. */
async function upsertTmdbMovies(rows) {
  const p = getPool();
  let ok = 0, failed = [];
  for (const row of rows) {
    try {
      await p.query(
        `insert into movies
           (tmdb_id, wikidata_id, title, original_title, synopsis, year, release_date,
            runtime_minutes, countries, languages, genres, directors, actors,
            external_ids, tmdb_popularity)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (tmdb_id) do update set
           wikidata_id=coalesce(excluded.wikidata_id, movies.wikidata_id),
           title=excluded.title, original_title=excluded.original_title,
           synopsis=excluded.synopsis, year=excluded.year, release_date=excluded.release_date,
           runtime_minutes=excluded.runtime_minutes, countries=excluded.countries,
           languages=excluded.languages, genres=excluded.genres, directors=excluded.directors,
           actors=excluded.actors, external_ids=excluded.external_ids,
           tmdb_popularity=excluded.tmdb_popularity, updated_at=now()`,
        [row.tmdb_id, row.wikidata_id, row.title, row.original_title, row.synopsis, row.year,
         row.release_date, row.runtime_minutes, row.countries, row.languages, row.genres,
         row.directors, row.actors, JSON.stringify(row.external_ids || {}), row.tmdb_popularity]
      );
      ok++;
    } catch (e) {
      failed.push({ tmdb_id: row.tmdb_id, reason: e.message });
    }
  }
  return { ok, failed };
}

/** Statistiques de complétude du catalogue (pour `npm run db:stats`). */
async function catalogStats() {
  const p = getPool();
  const { rows } = await p.query(`
    select
      count(*)::int as total,
      count(*) filter (where genres is not null and array_length(genres,1) > 0)::int as with_genres,
      count(*) filter (where year is not null)::int as with_year,
      count(*) filter (where runtime_minutes is not null)::int as with_runtime,
      count(*) filter (where directors is not null and array_length(directors,1) > 0)::int as with_directors,
      count(*) filter (where actors is not null and array_length(actors,1) > 0)::int as with_actors,
      count(*) filter (where enrichment_status = 'done')::int as with_llm_enrichment
    from movies
  `);
  return rows[0];
}

/** Upsert idempotent d'un lot de films (Wikidata + éventuel enrichissement DBpedia déjà fusionné), clé = wikidata_id. */
async function upsertWikidataV2Movies(rows) {
  const p = getPool();
  let ok = 0, failed = [];
  for (const row of rows) {
    try {
      await p.query(
        `insert into movies
           (wikidata_id, title, year, release_date, runtime_minutes,
            countries, genres, directors, actors, external_ids, wikipedia_url,
            synopsis_raw, dbpedia_uri, synopsis_source, synopsis_source_license,
            title_source, year_source, release_date_source, runtime_source,
            countries_source, genres_source, directors_source, actors_source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                 'wikidata','wikidata','wikidata','wikidata','wikidata','wikidata','wikidata','wikidata')
         on conflict (wikidata_id) do update set
           title=excluded.title, year=excluded.year, release_date=excluded.release_date,
           runtime_minutes=excluded.runtime_minutes, countries=excluded.countries,
           genres=excluded.genres, directors=excluded.directors, actors=excluded.actors,
           external_ids=excluded.external_ids, wikipedia_url=excluded.wikipedia_url,
           synopsis_raw=excluded.synopsis_raw, dbpedia_uri=excluded.dbpedia_uri,
           synopsis_source=excluded.synopsis_source, synopsis_source_license=excluded.synopsis_source_license,
           updated_at=now()`,
        [row.wikidata_id, row.title, row.year, row.release_date, row.runtime_minutes,
         row.countries, row.genres, row.directors, row.actors,
         JSON.stringify(row.external_ids || {}), row.wikipedia_url,
         row.synopsis_raw || null, row.dbpedia_uri || null,
         row.synopsis_raw ? "dbpedia" : null, row.synopsis_raw ? "CC BY-SA 3.0" : null]
      );
      ok++;
    } catch (e) {
      failed.push({ wikidata_id: row.wikidata_id, reason: e.message });
    }
  }
  return { ok, failed };
}

/* ---------- v2 : récupération immédiate + résolution progressive (cache partagé) ---------- */

/** Upsert d'un film au stade "fetched" (données principales, références encore non résolues). */
async function upsertFetchedMovie(row) {
  const p = getPool();
  await p.query(
    `insert into movies
       (wikidata_id, title, year, release_date, runtime_minutes, external_ids, wikipedia_url, wikipedia_title_en,
        synopsis_raw, dbpedia_uri, synopsis_source, synopsis_source_license,
        unresolved_refs, unresolvable_refs, wikidata_ref_status,
        title_source, year_source, release_date_source, runtime_source,
        genres_source, directors_source, countries_source, actors_source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'{}'::jsonb,$14,
             'wikidata','wikidata','wikidata','wikidata','wikidata','wikidata','wikidata','wikidata')
     on conflict (wikidata_id) do update set
       title=excluded.title, year=excluded.year, release_date=excluded.release_date,
       runtime_minutes=excluded.runtime_minutes, external_ids=excluded.external_ids,
       wikipedia_url=excluded.wikipedia_url, wikipedia_title_en=excluded.wikipedia_title_en,
       synopsis_raw=excluded.synopsis_raw, dbpedia_uri=excluded.dbpedia_uri,
       synopsis_source=excluded.synopsis_source, synopsis_source_license=excluded.synopsis_source_license,
       updated_at=now()`,
    [row.wikidata_id, row.title, row.year, row.release_date, row.runtime_minutes,
     JSON.stringify(row.external_ids || {}), row.wikipedia_url, row.wikipedia_title_en || null,
     row.synopsis_raw || null, row.dbpedia_uri || null,
     row.synopsis_raw ? "dbpedia" : null, row.synopsis_raw ? "CC BY-SA 3.0" : null,
     JSON.stringify(row.unresolved_refs || {}), row.wikidata_ref_status || "fetched"]
  );
}

/** Films sans synopsis (à retenter via DBpedia) — état recalculé à chaque appel, pas de checkpoint séparé nécessaire. */
async function getMoviesMissingSynopsis(limit = 2000) {
  const p = getPool();
  const { rows } = await p.query(
    `select id, wikidata_id, wikipedia_title_en, title from movies where synopsis_source is null limit $1`,
    [limit]
  );
  return rows;
}

async function updateWikipediaTitleEn(movieId, title) {
  const p = getPool();
  await p.query(`update movies set wikipedia_title_en=$2 where id=$1`, [movieId, title]);
}

async function applyDbpediaSynopsis(movieId, { synopsis_raw, dbpedia_uri }) {
  const p = getPool();
  await p.query(
    `update movies set synopsis_raw=$2, dbpedia_uri=$3, synopsis_source='dbpedia',
       synopsis_source_license='CC BY-SA 3.0', updated_at=now()
     where id=$1`,
    [movieId, synopsis_raw, dbpedia_uri]
  );
}

/** Films sans synopsis et sans titre anglais Wikipédia connu (rattrapage pour les anciens imports). */
async function getMoviesMissingEnTitle(limit = 2000) {
  const p = getPool();
  const { rows } = await p.query(
    `select id, wikidata_id from movies where synopsis_source is null and wikipedia_title_en is null limit $1`,
    [limit]
  );
  return rows;
}

/** Films dont le statut de résolution n'est pas encore "complete". */
async function getMoviesNeedingResolution(limit = 500) {
  const p = getPool();
  const { rows } = await p.query(
    `select id, wikidata_id, genres, directors, countries, actors,
            unresolved_refs, unresolvable_refs, wikidata_ref_status
     from movies where wikidata_ref_status != 'complete' limit $1`,
    [limit]
  );
  return rows;
}

/** Lit le cache de libellés pour un lot de Q-ids (évite de redemander à Wikidata). */
async function getCachedLabels(qids) {
  if (!qids.length) return new Map();
  const p = getPool();
  const { rows } = await p.query(`select qid, label, attempts, resolved from wikidata_labels where qid = any($1)`, [qids]);
  return new Map(rows.map(r => [r.qid, { label: r.label, attempts: r.attempts, resolved: r.resolved }]));
}

/** Upsert du cache de libellés après un appel wbgetentities de résolution. */
async function upsertLabelCache(entries) {
  const p = getPool();
  for (const e of entries) {
    await p.query(
      `insert into wikidata_labels (qid, label, attempts, resolved, updated_at)
       values ($1,$2,$3,$4,now())
       on conflict (qid) do update set
         label=excluded.label, attempts=excluded.attempts, resolved=excluded.resolved, updated_at=now()`,
      [e.qid, e.label, e.attempts, e.resolved]
    );
  }
}

/** Applique le résultat d'une résolution sur un film (genres/directors/... + statut). */
async function applyRefUpdate(movieId, update) {
  const p = getPool();
  await p.query(
    `update movies set genres=$2, directors=$3, countries=$4, actors=$5,
       unresolved_refs=$6, unresolvable_refs=$7, wikidata_ref_status=$8, updated_at=now()
     where id=$1`,
    [movieId, update.genres, update.directors, update.countries, update.actors,
     JSON.stringify(update.unresolved_refs), JSON.stringify(update.unresolvable_refs), update.wikidata_ref_status]
  );
}

async function refStatusCounts() {
  const p = getPool();
  const { rows } = await p.query(`select wikidata_ref_status, count(*)::int as n from movies group by wikidata_ref_status`);
  return Object.fromEntries(rows.map(r => [r.wikidata_ref_status, r.n]));
}

async function catalogSize() {
  const p = getPool();
  const { rows } = await p.query(`select count(*)::int as n from movies`);
  return rows[0].n;
}

module.exports = {
  isConfigured: () => Boolean(process.env.DATABASE_URL),
  getPool, upsertWikidataMovies, getMoviesNeedingDbpedia, applyDbpediaEnrichment,
  getMoviesPendingLlmEnrichment, applyLlmEnrichment, catalogSize,
  upsertTmdbMovies, catalogStats,
  upsertWikidataV2Movies,
  upsertFetchedMovie, getMoviesNeedingResolution, getCachedLabels, upsertLabelCache, applyRefUpdate, refStatusCounts,
  getMoviesMissingSynopsis, getMoviesMissingEnTitle, updateWikipediaTitleEn, applyDbpediaSynopsis,
};
