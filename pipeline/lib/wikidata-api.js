// pipeline/lib/wikidata-api.js
// Utilise UNIQUEMENT les API MediaWiki officielles de Wikidata (recherche +
// wbgetentities). Aucune requête SPARQL, aucun dump. Les fonctions réseau
// sont séparées des fonctions pures (extraction/mapping) pour rester
// testables hors-ligne.
"use strict";

const SEARCH_URL = "https://www.wikidata.org/w/api.php";
const HEADERS = { "User-Agent": "MovieFinderImportBot/1.0 (prototype; POC)" };

/* ---------- Réseau ---------- */

function makeHttpError(status, resp) {
  const err = new Error(`Wikidata HTTP ${status}`);
  err.status = status;
  const retryAfter = resp.headers && resp.headers.get ? resp.headers.get("retry-after") : null;
  if (retryAfter) err.retryAfterMs = parseInt(retryAfter, 10) * 1000;
  return err;
}

/** Étape 1 : découverte paginée des Q-ids de films (haswbstatement:P31=Q11424). */
async function searchFilmIds({ srlimit = 50, sroffset = 0 } = {}) {
  const params = new URLSearchParams({
    action: "query", list: "search",
    srsearch: "haswbstatement:P31=Q11424",
    srlimit: String(srlimit), sroffset: String(sroffset),
    format: "json",
  });
  const resp = await fetch(`${SEARCH_URL}?${params}`, { headers: HEADERS });
  if (!resp.ok) throw makeHttpError(resp.status, resp);
  const data = await resp.json();
  const ids = (data.query?.search || []).map(r => r.title);
  const nextOffset = data.continue ? data.continue.sroffset : null;
  const totalHits = data.query?.searchinfo?.totalhits ?? null;
  return { ids, nextOffset, totalHits };
}

/** Étape 2/3 : récupère jusqu'à 50 entités par appel (films OU entités référencées). */
async function getEntities(ids, { languages = "fr|en" } = {}) {
  if (ids.length === 0) return {};
  if (ids.length > 50) throw new Error("wbgetentities : 50 identifiants maximum par appel");
  const params = new URLSearchParams({
    action: "wbgetentities", ids: ids.join("|"), languages, format: "json",
  });
  const resp = await fetch(`${SEARCH_URL}?${params}`, { headers: HEADERS });
  if (!resp.ok) throw makeHttpError(resp.status, resp);
  const data = await resp.json();
  return data.entities || {};
}

/* ---------- Extraction pure (sans réseau) ---------- */

/** Valeurs (non dépréciées) d'une propriété donnée dans les claims d'une entité. */
function getClaimValues(entity, property) {
  const statements = (entity.claims && entity.claims[property]) || [];
  return statements
    .filter(s => s.rank !== "deprecated")
    .map(s => s.mainsnak && s.mainsnak.datavalue && s.mainsnak.datavalue.value)
    .filter(Boolean);
}

function bestLabel(entity, langs = ["fr", "en"]) {
  for (const l of langs) if (entity.labels && entity.labels[l]) return entity.labels[l].value;
  return null;
}

/**
 * Extrait les données brutes d'un film depuis son entité wbgetentities.
 * Les références (genre/réalisateur/acteur/pays) restent des Q-ids à ce
 * stade — elles seront résolues dans un second passage (voir résolution
 * des libellés référencés).
 */
function extractRawFilm(entity) {
  const dateVal = getClaimValues(entity, "P577")[0]; // date de publication
  const durationVal = getClaimValues(entity, "P2047")[0]; // durée (quantité)
  const imdbVal = getClaimValues(entity, "P345")[0]; // identifiant IMDb (string)

  // Wikidata ne connaît pas toujours le jour/mois exact d'une date (precision
  // 9 = année seule, 10 = mois, 11 = jour). Un "2014-00-00" n'est pas une date
  // SQL valide -> on ne garde release_date que si le jour est vraiment connu,
  // mais on extrait l'année dans tous les cas (elle reste fiable même sans le
  // reste, ce n'est jamais une invention).
  let releaseDate = null, yearFromDate = null;
  if (dateVal && dateVal.time) {
    const cleaned = dateVal.time.replace(/^\+/, "");
    const yearMatch = cleaned.match(/^(\d{4})/);
    if (yearMatch) yearFromDate = parseInt(yearMatch[1], 10);
    if (dateVal.precision >= 11) releaseDate = cleaned.slice(0, 10);
  }

  return {
    wikidata_id: entity.id,
    title: bestLabel(entity, ["fr", "en"]),
    release_date: releaseDate,
    year_from_date: yearFromDate,
    runtime_minutes: durationVal ? Math.round(parseFloat(durationVal.amount)) : null,
    imdb_id: imdbVal || null,
    country_refs: getClaimValues(entity, "P495").map(v => v.id),
    genre_refs: getClaimValues(entity, "P136").map(v => v.id),
    director_refs: getClaimValues(entity, "P57").map(v => v.id),
    cast_refs: getClaimValues(entity, "P161").map(v => v.id).slice(0, 10),
    wikipedia_title_fr: entity.sitelinks && entity.sitelinks.frwiki ? entity.sitelinks.frwiki.title : null,
    wikipedia_title_en: entity.sitelinks && entity.sitelinks.enwiki ? entity.sitelinks.enwiki.title : null,
  };
}

/** Collecte l'ensemble dédupliqué des Q-ids référencés par un lot de films bruts. */
function collectReferencedIds(rawFilms) {
  const set = new Set();
  for (const f of rawFilms) {
    f.country_refs.forEach(id => set.add(id));
    f.genre_refs.forEach(id => set.add(id));
    f.director_refs.forEach(id => set.add(id));
    f.cast_refs.forEach(id => set.add(id));
  }
  return [...set];
}

const GENRE_MAP = [
  [/comédi|comedy/i, "comedy"], [/action/i, "action"], [/thriller/i, "thriller"],
  [/science.?fiction|science-fiction film/i, "scifi"], [/romance|romantique|romantic/i, "romance"],
  [/drame|drama/i, "drama"], [/crime|policier/i, "crime"],
  [/aventure|adventure/i, "adventure"], [/musical|comédie musicale/i, "musical"],
  [/horreur|horror/i, "horror"], [/animation/i, "animation"], [/documentaire|documentary/i, "documentary"],
  [/familial|family/i, "family"], [/fantastique|fantasy/i, "fantasy"], [/mystère|mystery/i, "mystery"],
  [/guerre|war film/i, "war"], [/western/i, "western"], [/histoire|historical/i, "history"],
];
function mapGenreLabel(label) {
  for (const [re, g] of GENRE_MAP) if (re.test(label)) return g;
  return null;
}

/**
 * Construit la ligne "fetched" (données principales uniquement) — les
 * catégories essentielles (genres/réalisateurs/pays/acteurs) ne sont PAS
 * résolues ici : elles restent en Q-ids dans `unresolved_refs` (cf.
 * pipeline/lib/wikidata-refs.js), résolues progressivement dans une passe
 * séparée. Ne devine JAMAIS une valeur manquante.
 */
function buildFetchedRow(raw) {
  const year = raw.year_from_date; // extrait indépendamment de la précision de la date
  const wikipedia_url = raw.wikipedia_title_fr
    ? `https://fr.wikipedia.org/wiki/${encodeURIComponent(raw.wikipedia_title_fr.replace(/ /g, "_"))}`
    : (raw.wikipedia_title_en ? `https://en.wikipedia.org/wiki/${encodeURIComponent(raw.wikipedia_title_en.replace(/ /g, "_"))}` : null);

  return {
    wikidata_id: raw.wikidata_id,
    title: raw.title,
    original_title: null, // Wikidata n'a pas de propriété fiable pour "titre original" -> jamais deviné
    year,
    release_date: raw.release_date,
    runtime_minutes: raw.runtime_minutes,
    external_ids: raw.imdb_id ? { imdb_id: raw.imdb_id } : {},
    wikipedia_title_en: raw.wikipedia_title_en, // utile pour l'enrichissement DBpedia (titre anglais)
    wikipedia_url,
  };
}

/** Une ligne "fetched" est utilisable dès que les données principales existent. */
function isUsable(row) {
  return Boolean(row.title && (row.year || row.runtime_minutes));
}

/** Extrait les titres d'articles Wikipédia (FR/EN) depuis les sitelinks d'une entité wbgetentities. Lecture seule, jamais deviné. */
function extractSitelinkTitles(entity) {
  return {
    fr: entity && entity.sitelinks && entity.sitelinks.frwiki ? entity.sitelinks.frwiki.title : null,
    en: entity && entity.sitelinks && entity.sitelinks.enwiki ? entity.sitelinks.enwiki.title : null,
  };
}

module.exports = {
  searchFilmIds, getEntities,
  getClaimValues, bestLabel, extractRawFilm, collectReferencedIds,
  mapGenreLabel, buildFetchedRow, isUsable, extractSitelinkTitles,
};
