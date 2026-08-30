-- Movie Finder — schéma de base de données cible (PostgreSQL)
--
-- La recherche vectorielle (pgvector) est OPTIONNELLE pour cette étape.
-- Si ta base ne l'a pas, commente les 2 lignes marquées "PGVECTOR" ci-dessous —
-- tout le reste (catalogue, recherche structurée, notes, historique) fonctionne
-- sans elle. Pour l'avoir nativement : `docker run ... pgvector/pgvector:pg16`
-- au lieu de l'image `postgres:16` standard, ou active l'extension "vector"
-- dans le tableau de bord si tu utilises Neon/Supabase (les deux la supportent).

create extension if not exists vector; -- PGVECTOR (commente cette ligne si non disponible)

create table users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  deleted_at timestamptz -- soft delete, cf. section "vie privée"
);

create table movies (
  id uuid primary key default gen_random_uuid(),
  tmdb_id integer unique,
  tmdb_popularity numeric,
  wikidata_id text unique,
  dbpedia_uri text,
  title text not null,
  original_title text,
  synopsis text,               -- reformulé par nos soins, jamais copié verbatim (cf. DATA_SOURCES.md)
  synopsis_raw text,           -- texte brut DBpedia (CC BY-SA), en attente de reformulation
  synopsis_source_license text,

  -- Provenance par champ (cf. DATA_SOURCES.md §3) : quelle source a fourni cette donnée.
  title_source text default 'wikidata',
  original_title_source text default 'wikidata',
  year_source text default 'wikidata',
  release_date_source text default 'wikidata',
  runtime_source text default 'wikidata',
  countries_source text default 'wikidata',
  genres_source text default 'wikidata',
  directors_source text default 'wikidata',
  actors_source text default 'wikidata',
  synopsis_source text, -- 'dbpedia' une fois enrichi ; null tant que non renseigné

  -- Suivi de la résolution progressive des références Wikidata (genre/réalisateur/
  -- pays/acteurs sont des Q-ids à résoudre séparément, cf. DATA_SOURCES.md).
  unresolved_refs jsonb not null default '{}'::jsonb,   -- {genres:["Q..."], directors:[...], countries:[...], actors:[...]}
  unresolvable_refs jsonb not null default '{}'::jsonb, -- même forme, pour les ids abandonnés après 3 tentatives
  wikidata_ref_status text not null default 'fetched',  -- 'fetched' | 'enriched' | 'complete'

  year int,
  release_date date,
  runtime_minutes int,
  countries text[],
  languages text[],
  genres text[],
  directors text[],
  actors text[],
  external_ids jsonb,          -- imdb_id, tmdb_id (facultatif), etc.
  wikipedia_url text,
  wikipedia_title_en text, -- titre anglais Wikipédia, nécessaire pour retrouver la ressource DBpedia
  poster_url text,              -- vide tant qu'aucune source d'affiches licenciée n'est branchée
  backdrop_url text,

  -- champs propres à Movie Finder (non présents dans Wikidata)
  moods text[],
  intensity smallint,           -- 0-10
  humor smallint,
  romance smallint,
  action smallint,
  violence smallint,
  complexity smallint,
  feel_good smallint,
  good_for text[],              -- couple, friends, family, solo, evening
  tags text[],
  enrichment_status text not null default 'pending', -- pending | done (cf. brief §5 : jamais relancé automatiquement)

  embedding vector(1536),       -- PGVECTOR (commente cette ligne si non disponible) — réservé recherche sémantique (section 25)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on movies using gin (genres);
create index on movies using gin (moods);
create index on movies (enrichment_status);
create index on movies using ivfflat (embedding vector_cosine_ops); -- PGVECTOR (commente cette ligne si non disponible)

create table searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  query text not null,
  parsed_query jsonb not null,   -- sortie de l'étape d'interprétation LLM
  created_at timestamptz not null default now()
);
create index on searches (user_id);

create table ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) not null,
  movie_id uuid references movies(id) not null,
  search_id uuid references searches(id),
  search_fit_rating smallint not null check (search_fit_rating between 1 and 5),
  movie_quality_rating smallint not null check (movie_quality_rating between 1 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, movie_id, search_id)
);
create index on ratings (movie_id);

create table watch_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) not null,
  movie_id uuid references movies(id) not null,
  search_id uuid references searches(id),
  watched_at timestamptz not null default now()
);
create index on watch_history (user_id);

-- Cache persistant des libellés Wikidata (genre/réalisateur/pays/acteur).
-- Un même identifiant (ex. un acteur récurrent) est référencé par des
-- dizaines de films : ce cache évite de le redemander à chaque fois, ce qui
-- réduit fortement le risque de limitation de débit à grande échelle.
create table wikidata_labels (
  qid text primary key,
  label text,                          -- null tant que non résolu
  attempts int not null default 0,     -- tentatives de résolution échouées
  resolved boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Statistiques communautaires agrégées (rafraîchies périodiquement ou en continu)
create materialized view movie_stats as
select
  movie_id,
  avg(movie_quality_rating) as quality_avg,
  count(*) filter (where movie_quality_rating is not null) as quality_count,
  avg(search_fit_rating) as fit_avg,
  count(*) filter (where search_fit_rating is not null) as fit_count,
  round(100.0 * count(*) filter (where search_fit_rating >= 4) / nullif(count(*),0)) as like_pct
from ratings
group by movie_id;

-- Vie privée : les recherches (table `searches`) contiennent potentiellement
-- des informations personnelles en langage libre. Elles ne doivent JAMAIS
-- être exposées à d'autres utilisateurs ni utilisées telles quelles dans les
-- statistiques publiques — seules les agrégations anonymisées (movie_stats)
-- sont publiques. La suppression d'un compte (soft delete sur `users`, puis
-- purge différée) doit cascader sur `searches`, `ratings`, `watch_history`.
