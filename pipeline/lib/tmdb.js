// pipeline/lib/tmdb.js
// Fonctions PURES (aucun accès réseau ici) : mapping des réponses TMDB vers
// le schéma `movies`. Testables hors-ligne avec des fixtures.
"use strict";

const TMDB_GENRE_MAP = [
  [/comédi/i, "comedy"], [/action/i, "action"], [/thriller/i, "thriller"],
  [/science.?fiction/i, "scifi"], [/romance/i, "romance"],
  [/drame/i, "drama"], [/crime/i, "crime"],
  [/aventure/i, "adventure"], [/musi/i, "musical"], [/horreur/i, "horror"],
  [/animation/i, "animation"], [/documentaire/i, "documentary"],
  [/familial/i, "family"], [/fantastique/i, "fantasy"], [/mystère/i, "mystery"],
  [/guerre/i, "war"], [/western/i, "western"], [/histoire/i, "history"],
];

function mapTmdbGenre(name) {
  for (const [re, g] of TMDB_GENRE_MAP) if (re.test(name)) return g;
  return null;
}

/**
 * Transforme la réponse TMDB `/movie/{id}?append_to_response=credits,external_ids`
 * en ligne prête pour la table `movies`. Ne devine JAMAIS un champ manquant.
 */
function mapTmdbMovieToRow(details) {
  const year = details.release_date ? parseInt(details.release_date.slice(0, 4), 10) : null;
  const genres = (details.genres || []).map(g => mapTmdbGenre(g.name)).filter(Boolean);
  const directors = ((details.credits && details.credits.crew) || [])
    .filter(c => c.job === "Director").map(c => c.name);
  const actors = ((details.credits && details.credits.cast) || [])
    .slice(0, 6).map(c => c.name);
  const externalIds = details.external_ids || {};

  return {
    tmdb_id: details.id,
    wikidata_id: externalIds.wikidata_id || null,
    title: details.title || details.original_title || null,
    original_title: details.original_title || null,
    synopsis: details.overview && details.overview.trim() ? details.overview.trim() : null,
    year: Number.isFinite(year) ? year : null,
    release_date: details.release_date || null,
    runtime_minutes: Number.isInteger(details.runtime) && details.runtime > 0 ? details.runtime : null,
    countries: (details.production_countries || []).map(c => c.name),
    languages: (details.spoken_languages || []).map(l => l.iso_639_1).filter(Boolean),
    genres,
    directors,
    actors,
    external_ids: { imdb_id: externalIds.imdb_id || null },
    wikipedia_url: null,
    tmdb_popularity: typeof details.popularity === "number" ? details.popularity : null,
  };
}

/** Un film est jugé "assez complet" pour entrer dans le catalogue v1 (mêmes règles qu'avant). */
function isUsable(movieRow) {
  return Boolean(
    movieRow.title &&
    movieRow.genres.length > 0 &&
    (movieRow.year || movieRow.runtime_minutes)
  );
}

/** Parse une ligne du fichier d'export quotidien TMDB (JSON Lines). */
function parseExportLine(line) {
  if (!line || !line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    if (obj.adult) return null; // hors périmètre de ce catalogue
    return { id: obj.id, popularity: obj.popularity || 0 };
  } catch (e) {
    return null; // ligne corrompue -> ignorée, pas d'échec global
  }
}

module.exports = { mapTmdbGenre, mapTmdbMovieToRow, isUsable, parseExportLine };
