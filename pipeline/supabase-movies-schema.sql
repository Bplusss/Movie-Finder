-- pipeline/supabase-movies-schema.sql
-- PHASE 1 de la migration catalogue V3.2 -> Supabase.
--
-- IMPORTANT -- HISTORIQUE DE CE RENOMMAGE :
-- Une table `movies` existait DEJA sur ce projet Supabase (1018 lignes) —
-- c'est la table BRUTE du tout premier pipeline d'import Wikidata/DBpedia,
-- activement lue par pipeline/build-final-dataset.js
-- (`select ... from movies where id = any($1)`). Elle sert encore et
-- servira probablement a l'import des futurs 5000 films. Pour ne jamais
-- entrer en collision avec elle, la table de production du moteur V3
-- s'appelle ici `movies_catalog`, PAS `movies`.
--
-- Cree UNIQUEMENT movies_catalog. N'importe aucune donnee (Phase 2).
-- Ne touche PAS a la table `movies` existante. Aucune table relationnelle
-- supplementaire, aucun pgvector.

create table if not exists movies_catalog (
  -- Cle stable, identique a celle deja utilisee dans le JSON et dans tout
  -- le moteur (facts.actors/directors/genres sont indexes par wikidata_id
  -- partout dans movie-search-v3.js). La contrainte PRIMARY KEY protege
  -- nativement contre les doublons -- un import ne peut jamais en creer.
  wikidata_id text primary key,

  movie_id text,
  title text not null,

  -- facts.* du JSON actuel -- noms de colonnes conserves proches de
  -- l'original, aucun renommage sans raison.
  year integer,
  runtime_minutes integer,
  countries jsonb,
  genres jsonb,
  directors jsonb,
  actors jsonb,

  -- source.* du JSON actuel
  wikipedia_language text,
  wikipedia_title text,

  -- Fusionnes aujourd'hui a l'execution depuis wikipedia-synopsis-1018.json —
  -- integres ici pour que le runtime n'ait plus besoin de ce fichier separe.
  intro_text text,
  synopsis_text text,

  -- Conserves tels quels, INERTES au runtime actuel (non lus par
  -- movie-search-v3.js) -- gardes par prudence, pas pour etre utilises
  -- maintenant.
  semantic_profile jsonb,
  semantic_status text,
  semantic_warnings jsonb,
  adult_content jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index d'administration uniquement (retrouver un film par son movie_id
-- pendant l'import/le diagnostic) -- PAS une optimisation de recherche,
-- aucun index cree pour accelerer le moteur (qui charge tout en memoire).
create index if not exists movies_catalog_movie_id_idx on movies_catalog (movie_id);
