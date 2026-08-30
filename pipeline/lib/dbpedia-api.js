// pipeline/lib/dbpedia-api.js
// Récupère le synopsis d'UN film via son URI de ressource DBpedia dérivée du
// titre anglais Wikipédia (sitelink enwiki) — un GET simple par film, jamais
// de requête SPARQL, jamais de dump complet.
"use strict";

function titleToDbpediaName(enTitle) {
  return enTitle.trim().replace(/ /g, "_");
}

function dbpediaResourceUri(enTitle) {
  return `http://dbpedia.org/resource/${titleToDbpediaName(enTitle)}`;
}

function dbpediaDataUrl(enTitle) {
  return `https://dbpedia.org/data/${encodeURIComponent(titleToDbpediaName(enTitle))}.json`;
}

/**
 * Extrait le résumé (dbo:abstract, anglais) depuis la réponse JSON du point
 * d'accès Linked Data de DBpedia (format RDF/JSON : objet clé = URI de
 * ressource, valeur = map prédicat -> tableau de {value, lang, type}).
 */
function extractAbstract(json, resourceUri) {
  const resource = json[resourceUri];
  if (!resource) return null;
  const abstracts = resource["http://dbpedia.org/ontology/abstract"];
  if (!abstracts || !abstracts.length) return null;
  const en = abstracts.find(a => a.lang === "en") || abstracts[0];
  return en && en.value ? en.value.trim() : null;
}

async function fetchSynopsis(enTitle) {
  const resourceUri = dbpediaResourceUri(enTitle);
  const url = dbpediaDataUrl(enTitle);
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (!resp.ok) {
    if (resp.status === 404) return null; // film absent de DBpedia -> pas une erreur
    throw new Error(`DBpedia HTTP ${resp.status}`);
  }
  const json = await resp.json();
  const abstract = extractAbstract(json, resourceUri);
  if (!abstract) return null;
  return { synopsis_raw: abstract, dbpedia_uri: resourceUri };
}

module.exports = { titleToDbpediaName, dbpediaResourceUri, dbpediaDataUrl, extractAbstract, fetchSynopsis };
