// pipeline/lib/wikidata.js
// Fonctions PURES (aucun accès réseau ici) : construction de requête SPARQL et
// mapping des lignes de résultat vers le schéma movies. Testables hors-ligne.
"use strict";

const WD_GENRE_MAP = [
  [/comédi/i, "comedy"], [/action/i, "action"], [/thriller|suspense/i, "thriller"],
  [/science.?fiction/i, "scifi"], [/romance|romantique/i, "romance"],
  [/drame|dramatique/i, "drama"], [/crime|policier/i, "crime"],
  [/aventure/i, "adventure"], [/musical/i, "musical"], [/horreur/i, "horror"],
  [/animation/i, "animation"], [/documentaire/i, "documentary"],
];

function mapWdGenre(label) {
  for (const [re, g] of WD_GENRE_MAP) if (re.test(label)) return g;
  return null;
}

/**
 * Construit la requête SPARQL pour une page de résultats.
 * On restreint aux films ayant un minimum de notoriété (sitelinks) pour
 * privilégier la qualité sur la quantité (cf. brief §3).
 */
/**
 * Étape 1 (légère) : récupère uniquement les identifiants de films dans une
 * page donnée. Un seul motif de triplet, sans jointure ni filtre coûteux
 * (le filtre de notoriété par sitelinks s'est révélé trop coûteux à calculer
 * côté serveur public de Wikidata) — la qualité est assurée en aval par
 * isUsable() sur les métadonnées réellement récupérées à l'étape 2.
 */
function buildFilmIdsQuery({ offset = 0, limit = 100 } = {}) {
  return `
    SELECT ?film WHERE {
      ?film wdt:P31 wd:Q11424 .
    }
    ORDER BY ?film
    OFFSET ${offset}
    LIMIT ${limit}
  `;
}

/**
 * Étape 2 (détails) : pour un lot RESTREINT de films déjà identifiés (VALUES),
 * récupère les métadonnées. Comme VALUES limite le calcul à ce petit lot,
 * les jointures OPTIONAL restent bon marché même si un film a beaucoup de
 * genres/acteurs.
 */
function buildDetailsQuery(filmUris) {
  const values = filmUris.map(uri => `wd:${uri.split("/").pop()}`).join(" ");
  return `
    SELECT ?film ?filmLabel ?date ?duration ?countryLabel ?directorLabel ?genreLabel ?castLabel ?imdb WHERE {
      VALUES ?film { ${values} }
      OPTIONAL { ?film wdt:P577 ?date }
      OPTIONAL { ?film wdt:P2047 ?duration }
      OPTIONAL { ?film wdt:P495 ?country }
      OPTIONAL { ?film wdt:P57 ?director }
      OPTIONAL { ?film wdt:P136 ?genre }
      OPTIONAL { ?film wdt:P161 ?cast }
      OPTIONAL { ?film wdt:P345 ?imdb }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    }
  `;
}

function buildWikidataQuery(opts) {
  // Conservé pour compatibilité / tests existants, mais plus utilisé par
  // import-wikidata.js (remplacé par la stratégie en 2 étapes ci-dessus,
  // beaucoup plus légère pour le point d'accès public de Wikidata).
  const { offset = 0, limit = 200, minSitelinks = 15 } = opts || {};
  return `
    SELECT ?film ?filmLabel ?date ?duration ?countryLabel ?directorLabel ?genreLabel ?castLabel ?imdb ?sitelinks WHERE {
      ?film wdt:P31 wd:Q11424 ;
            wikibase:sitelinks ?sitelinks .
      FILTER(?sitelinks >= ${minSitelinks})
      OPTIONAL { ?film wdt:P577 ?date }
      OPTIONAL { ?film wdt:P2047 ?duration }
      OPTIONAL { ?film wdt:P495 ?country }
      OPTIONAL { ?film wdt:P57 ?director }
      OPTIONAL { ?film wdt:P136 ?genre }
      OPTIONAL { ?film wdt:P161 ?cast }
      OPTIONAL { ?film wdt:P345 ?imdb }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
    }
    ORDER BY ?film
    OFFSET ${offset}
    LIMIT ${limit}
  `;
}

/**
 * Regroupe les lignes SPARQL (un film peut apparaître sur plusieurs lignes
 * à cause des OPTIONAL multi-valués : genres, réalisateurs, acteurs) en un
 * objet film unique.
 */
function groupBindings(bindings) {
  const byUri = new Map();
  for (const row of bindings) {
    const uri = row.film.value;
    if (!byUri.has(uri)) {
      byUri.set(uri, {
        wikidata_uri: uri,
        wikidata_id: uri.split("/").pop(),
        title: row.filmLabel ? row.filmLabel.value : null,
        date: row.date ? row.date.value : null,
        duration: row.duration ? row.duration.value : null,
        country: row.countryLabel ? row.countryLabel.value : null,
        directors: new Set(),
        genres: new Set(),
        cast: new Set(),
        imdb_id: row.imdb ? row.imdb.value : null,
        sitelinks: row.sitelinks ? parseInt(row.sitelinks.value, 10) : 0,
      });
    }
    const f = byUri.get(uri);
    if (row.directorLabel) f.directors.add(row.directorLabel.value);
    if (row.castLabel) f.cast.add(row.castLabel.value);
    if (row.genreLabel) {
      const g = mapWdGenre(row.genreLabel.value);
      if (g) f.genres.add(g);
    }
  }
  return [...byUri.values()];
}

/**
 * Transforme un film groupé en ligne prête pour la table `movies`.
 * Ne devine JAMAIS un champ manquant : il reste `null`.
 */
function toMovieRow(film) {
  const year = film.date ? new Date(film.date).getFullYear() : null;
  return {
    wikidata_id: film.wikidata_id,
    title: film.title,
    original_title: null, // à enrichir séparément si besoin (P1476 dans une v2)
    year: Number.isFinite(year) ? year : null,
    release_date: film.date ? film.date.slice(0, 10) : null,
    runtime_minutes: film.duration ? Math.round(parseFloat(film.duration)) : null,
    countries: film.country ? [film.country] : [],
    languages: [],
    genres: [...film.genres],
    directors: [...film.directors],
    actors: [...film.cast],
    external_ids: film.imdb_id ? { imdb_id: film.imdb_id } : {},
    wikipedia_url: null, // récupéré via sitelinks si besoin (appel additionnel, hors v1)
    _sitelinks: film.sitelinks, // signal de notoriété, pas stocké tel quel en prod
  };
}

/** Un film est jugé "assez complet" pour entrer dans le catalogue v1 (brief §3). */
function isUsable(movieRow) {
  return Boolean(
    movieRow.title &&
    movieRow.genres.length > 0 &&
    (movieRow.year || movieRow.runtime_minutes)
  );
}

module.exports = { buildWikidataQuery, buildFilmIdsQuery, buildDetailsQuery, groupBindings, toMovieRow, isUsable, mapWdGenre };
