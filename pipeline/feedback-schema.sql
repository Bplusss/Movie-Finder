-- pipeline/feedback-schema.sql
-- Table ADDITIVE pour le feedback du prototype V3 en ligne.
-- Ne touche JAMAIS a la table existante des films (voir schema.sql, jamais modifie).
-- A executer une seule fois sur ton instance Supabase (SQL Editor du dashboard).

create table if not exists feedback (
  id bigint generated always as identity primary key,
  query text not null,
  film_id text not null,
  film_title text,
  position integer,
  score integer,
  relevance_rating integer check (relevance_rating between 1 and 5),
  film_rating integer check (film_rating between 1 and 5),
  irrelevance_reasons text[],
  session_id text,
  created_at timestamptz not null default now(),
  -- Cle naturelle pour une migration idempotente depuis feedback-log.json :
  -- reinserer la meme entree (meme requete/film/session/horodatage) ne cree
  -- jamais de doublon (ON CONFLICT DO NOTHING cote script de migration).
  unique (query, film_id, session_id, created_at)
);

create index if not exists feedback_query_idx on feedback (query);
create index if not exists feedback_film_id_idx on feedback (film_id);
create index if not exists feedback_session_id_idx on feedback (session_id);

-- Row Level Security : defense en profondeur. Dans cette architecture, le
-- navigateur ne parle JAMAIS directement a Supabase (ni cle anon, ni cle
-- service_role cote client) — seul le serveur ecrit, via une connexion
-- Postgres directe (DATABASE_URL, jamais exposee au navigateur). RLS n'est
-- donc pas strictement necessaire pour la securite ici, mais on l'active
-- quand meme en filet de securite au cas ou une cle serait un jour exposee
-- par erreur : seul l'INSERT est autorise publiquement, jamais la lecture.
alter table feedback enable row level security;

create policy "insertion publique uniquement" on feedback
  for insert
  to anon, authenticated
  with check (true);

-- Explicitement AUCUNE politique de lecture/mise a jour/suppression pour
-- anon/authenticated -- seul un acces avec privileges eleves (le role
-- utilise par DATABASE_URL) peut lire les feedbacks.
