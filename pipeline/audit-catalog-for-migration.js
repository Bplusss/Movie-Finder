#!/usr/bin/env node
// pipeline/audit-catalog-for-migration.js
// node pipeline/audit-catalog-for-migration.js
//
// AUDIT LECTURE SEULE pour la migration Supabase (Phase 0 -> Phase 1). Ne
// modifie aucun fichier, ne cree aucune table. Reutilise EXACTEMENT la meme
// logique de fusion introText/synopsisOnlyText que prototype-v3-server.js
// (aucune divergence entre ce qui est audite et ce qui tourne en production).
"use strict";
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");

function buildTextFields(finalCatalogMovies, wikipediaResults) {
  const byWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  return finalCatalogMovies.map(m => {
    const r = byWikidataId.get(m.wikidata_id);
    const data = r ? (r.lang_used === "fr" ? r.fr : r.en) : null;
    return { ...m, introText: data && data.intro ? data.intro : "", synopsisOnlyText: data && data.synopsis_text ? data.synopsis_text : "", _hadWikipediaEntry: !!r };
  });
}

function run() {
  const { movies, stats } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const merged = buildTextFields(movies, wikipediaResults);

  const uniqueIds = new Set(movies.map(m => m.wikidata_id)).size;
  const noTitle = movies.filter(m => !m.title || !m.title.trim()).length;
  const noYear = movies.filter(m => !m.facts || m.facts.year == null).length;
  const noCountry = movies.filter(m => !m.facts || !m.facts.countries || m.facts.countries.length === 0).length;
  const noGenre = movies.filter(m => !m.facts || !m.facts.genres || m.facts.genres.length === 0).length;
  const noDirector = movies.filter(m => !m.facts || !m.facts.directors || m.facts.directors.length === 0).length;
  const noActor = movies.filter(m => !m.facts || !m.facts.actors || m.facts.actors.length === 0).length;
  const noIntro = merged.filter(m => !m.introText).length;
  const noSynopsis = merged.filter(m => !m.synopsisOnlyText).length;
  const adultFlagged = movies.filter(m => m.adult_content && m.adult_content.flagged === true).length;
  const withSemanticProfile = movies.filter(m => m.semantic_profile && Object.keys(m.semantic_profile).length > 0).length;
  const missingWikipediaEntry = merged.filter(m => !m._hadWikipediaEntry);

  console.log("=== A. STATISTIQUES REELLES DU CATALOGUE ===\n");
  console.log(`1.  Nombre total de films             : ${stats.total}`);
  console.log(`2.  wikidata_id uniques                : ${uniqueIds}`);
  console.log(`3.  Doublons (wikidata_id)             : ${stats.duplicateCount}${stats.duplicateCount ? " -> " + JSON.stringify(stats.duplicateWikidataIds) : ""}`);
  console.log(`4.  Sans titre                          : ${noTitle}`);
  console.log(`5.  Sans annee                          : ${noYear}`);
  console.log(`6.  Sans pays                           : ${noCountry}`);
  console.log(`7.  Sans genre                          : ${noGenre}`);
  console.log(`8.  Sans realisateur                    : ${noDirector}`);
  console.log(`9.  Sans acteur                         : ${noActor}`);
  console.log(`10. Sans introText (apres fusion)       : ${noIntro}`);
  console.log(`11. Sans synopsisOnlyText (apres fusion): ${noSynopsis}`);
  console.log(`12. adult_content.flagged === true      : ${adultFlagged}`);
  console.log(`13. Avec semantic_profile present       : ${withSemanticProfile}`);

  console.log(`\n=== VERIFICATION CROISEE WIKIPEDIA ===`);
  console.log(`Films du catalogue principal SANS entree Wikipedia correspondante : ${missingWikipediaEntry.length}`);
  if (missingWikipediaEntry.length) {
    console.log(`Echantillon (jusqu'a 10) :`);
    missingWikipediaEntry.slice(0, 10).forEach(m => console.log(`  - ${m.title} (${m.wikidata_id})`));
  }

  console.log(`\n=== PROFIL SEMANTIQUE : STATUTS ===`);
  const byStatus = {};
  movies.forEach(m => { byStatus[m.semantic_status] = (byStatus[m.semantic_status] || 0) + 1; });
  console.log(JSON.stringify(byStatus, null, 2));

  console.log(`\nFIN — audit en lecture seule, aucune modification effectuee, aucune table creee.`);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = { run, buildTextFields };
