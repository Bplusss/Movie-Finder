// dbpedia/lib/matcher.js
// Logique PURE de correspondance films <-> ressources DBpedia. Aucun accès
// réseau/fichier ici — les appelants passent des flux déjà parsés. Testable
// intégralement hors-ligne avec des fixtures.
"use strict";

function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // enlève les accents
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wikidataIdFromUri(uri) {
  const m = uri.match(/entity\/(Q\d+)$/);
  return m ? m[1] : null;
}

/**
 * À partir d'un flux de triples sameAs (dbpedia_uri -> wikidata uri), ne
 * garde QUE les correspondances utiles à notre ensemble cible de wikidata_id
 * (évite de charger en mémoire des millions de liens inutiles).
 */
function buildWikidataIndex(triples, targetWikidataIds) {
  const index = new Map(); // wikidata_id -> dbpedia_uri
  for (const t of triples) {
    if (!/sameAs$/.test(t.predicate)) continue;
    const wdId = wikidataIdFromUri(t.object);
    if (wdId && targetWikidataIds.has(wdId) && !index.has(wdId)) {
      index.set(wdId, t.subject);
    }
  }
  return index;
}

/** Index générique clé=URI DBpedia -> valeur (label/abstract/...), filtré à un ensemble cible d'URIs utiles. */
function buildAttributeIndex(triples, targetUris, { predicateSuffix, lang = "en" } = {}) {
  const index = new Map();
  for (const t of triples) {
    if (!t.predicate.endsWith(predicateSuffix)) continue;
    if (lang && t.lang !== lang) continue;
    if (!targetUris.has(t.subject)) continue;
    if (!index.has(t.subject)) index.set(t.subject, t.object);
  }
  return index;
}

/** Index label -> [uris] pour le repli par titre (uniquement utilisé si le lien Wikidata a échoué). */
function buildLabelLookup(labelIndex) {
  const byNormalizedLabel = new Map();
  for (const [uri, label] of labelIndex) {
    const key = normalizeTitle(label);
    if (!byNormalizedLabel.has(key)) byNormalizedLabel.set(key, []);
    byNormalizedLabel.get(key).push(uri);
  }
  return byNormalizedLabel;
}

/**
 * Fait correspondre chaque film à sa ressource DBpedia, en PRIORITÉ via son
 * identifiant Wikidata (fiable), avec repli par titre normalisé UNIQUEMENT
 * si aucun lien Wikidata n'a été trouvé (moins fiable, marqué comme tel).
 */
function matchFilms(films, { wikidataIndex, labelIndex, abstractIndex, longAbstractIndex, labelLookup }) {
  const results = [];
  for (const film of films) {
    let dbpediaUri = wikidataIndex.get(film.wikidata_id) || null;
    let matchMethod = dbpediaUri ? "wikidata_sameas" : null;

    if (!dbpediaUri && film.title) {
      const candidates = labelLookup.get(normalizeTitle(film.title)) || [];
      if (candidates.length === 1) { dbpediaUri = candidates[0]; matchMethod = "title_fallback"; }
      else if (candidates.length > 1) { matchMethod = null; }
    }

    if (!dbpediaUri) {
      results.push({
        wikidata_id: film.wikidata_id, title: film.title, matched: false,
        reason: film.title && (labelLookup.get(normalizeTitle(film.title)) || []).length > 1
          ? "titre ambigu (plusieurs ressources DBpedia portent ce nom)"
          : "aucun lien sameAs Wikidata trouvé et aucun titre correspondant",
      });
      continue;
    }

    results.push({
      wikidata_id: film.wikidata_id, title: film.title, matched: true, match_method: matchMethod,
      dbpedia_uri: dbpediaUri,
      label: labelIndex.get(dbpediaUri) || null,
      abstract: abstractIndex.get(dbpediaUri) || null,
      long_abstract: longAbstractIndex.get(dbpediaUri) || null,
    });
  }
  return results;
}

module.exports = { normalizeTitle, wikidataIdFromUri, buildWikidataIndex, buildAttributeIndex, buildLabelLookup, matchFilms };
