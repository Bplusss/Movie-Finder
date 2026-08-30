#!/usr/bin/env node
// pipeline/import-dbpedia.js
//
// Enrichissement DBpedia : synopsis brut + catégories, fusionnés sur les films
// déjà importés depuis Wikidata. Ne crée JAMAIS de nouveau film (cf. §17
// priorité à la déduplication). Le texte récupéré est en CC BY-SA 3.0 : il
// est stocké dans `synopsis_raw`, PAS dans `synopsis` — un synopsis affiché
// publiquement doit être reformulé (édition manuelle ou passage par
// enrich-llm.js) pour éviter toute obligation de partage à l'identique sur
// notre propre texte (cf. DATA_SOURCES.md).
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const db = require("./lib/db");
const { mergeDbpediaIntoWikidata } = require("./lib/dedupe");

const DBPEDIA_ENDPOINT = "https://dbpedia.org/sparql";
const MOVIES_FILE = path.join(__dirname, "output-movies.jsonl");
const ENRICHED_FILE = path.join(__dirname, "output-dbpedia-enrichment.jsonl");

async function loadImportedMovies() {
  if (db.isConfigured()) {
    return await db.getMoviesNeedingDbpedia();
  }
  if (!fs.existsSync(MOVIES_FILE)) {
    throw new Error(`${MOVIES_FILE} introuvable — lance d'abord import-wikidata.js`);
  }
  return fs.readFileSync(MOVIES_FILE, "utf8")
    .split("\n").filter(Boolean).map(l => JSON.parse(l));
}

async function fetchDbpediaAbstract(wikidataId) {
  // DBpedia expose des liens owl:sameAs vers Wikidata pour la plupart des films.
  const query = `
    SELECT ?dbpedia ?abstract WHERE {
      ?dbpedia owl:sameAs <http://www.wikidata.org/entity/${wikidataId}> .
      OPTIONAL { ?dbpedia dbo:abstract ?abstract . FILTER(lang(?abstract)="fr") }
    } LIMIT 1
  `;
  const url = `${DBPEDIA_ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const resp = await fetch(url, { headers: { Accept: "application/sparql-results+json" } });
  if (!resp.ok) throw new Error(`DBpedia HTTP ${resp.status}`);
  const data = await resp.json();
  const row = data.results.bindings[0];
  if (!row) return null;
  return {
    wikidata_id: wikidataId,
    dbpedia_uri: row.dbpedia.value,
    abstract: row.abstract ? row.abstract.value : null,
    title: null, year: null, categories: [],
  };
}

async function run() {
  const movies = await loadImportedMovies();
  console.log(`${movies.length} films Wikidata chargés. Enrichissement DBpedia en cours...`);

  const dbpediaRecords = [];
  let failed = 0;
  for (const m of movies) {
    try {
      const rec = await fetchDbpediaAbstract(m.wikidata_id);
      if (rec) dbpediaRecords.push(rec);
    } catch (e) {
      failed++; // un film en échec n'interrompt pas le lot
    }
    await new Promise(r => setTimeout(r, 300)); // ménager le point d'accès public
  }

  const { merged, unmatched, conflicts } = mergeDbpediaIntoWikidata(movies, dbpediaRecords);

  if (db.isConfigured()) {
    let applied = 0;
    for (const rec of merged) {
      try { await db.applyDbpediaEnrichment(rec); applied++; }
      catch (e) { console.warn(`Échec écriture ${rec.wikidata_id} : ${e.message}`); }
    }
    console.log(`Enrichi en base : ${applied}/${merged.length} films.`);
  } else {
    fs.writeFileSync(ENRICHED_FILE, merged.map(r => JSON.stringify(r)).join("\n") + "\n");
    console.log(`Enrichi (JSONL, pas de base connectée) : ${merged.length} films.`);
  }

  console.log(`Échecs réseau : ${failed}. Sans correspondance (ignorés, jamais créés) : ${unmatched.length}.`);
  if (conflicts.length) {
    console.log(`⚠️  ${conflicts.length} correspondances approximatives (titre+année) à valider manuellement.`);
  }
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}

module.exports = { run };
