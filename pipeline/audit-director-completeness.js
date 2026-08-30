#!/usr/bin/env node
// pipeline/audit-director-completeness.js
// node pipeline/audit-director-completeness.js
//
// Audit GENERAL (pas specifique a Nolan) : quantifie combien de films du
// catalogue ont un champ directors/actors vide, pour savoir si le cas
// "Christopher Nolan absent" est isole ou symptomatique d'un trou plus large.
// LECTURE SEULE — ne modifie ni ne corrige rien.
"use strict";
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");

function run() {
  const catalogPath = process.argv[2] || FINAL_CATALOG_PATH;
  const { movies } = loadCatalog(catalogPath);

  const noDirectors = movies.filter(m => !m.facts.directors || m.facts.directors.length === 0);
  const noActors = movies.filter(m => !m.facts.actors || m.facts.actors.length === 0);
  const noBoth = movies.filter(m => (!m.facts.directors || m.facts.directors.length === 0) && (!m.facts.actors || m.facts.actors.length === 0));

  console.log(`Catalogue : ${movies.length} films.\n`);
  console.log(`Films SANS aucun réalisateur enregistré : ${noDirectors.length} (${(100 * noDirectors.length / movies.length).toFixed(1)}%)`);
  console.log(`Films SANS aucun acteur enregistré      : ${noActors.length} (${(100 * noActors.length / movies.length).toFixed(1)}%)`);
  console.log(`Films SANS ni l'un ni l'autre            : ${noBoth.length}\n`);

  if (noDirectors.length) {
    console.log(`Échantillon de films sans réalisateur (jusqu'à 20) :`);
    noDirectors.slice(0, 20).forEach(m => console.log(`  - ${m.title} (${m.facts.year || "année inconnue"})`));
    if (noDirectors.length > 20) console.log(`  ... et ${noDirectors.length - 20} de plus.`);
  }

  console.log(`\nFIN — audit en lecture seule, aucune modification effectuée.`);
}

if (require.main === module) run();
module.exports = { run };
