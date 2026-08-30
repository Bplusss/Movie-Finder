#!/usr/bin/env node
// pipeline/benchmark-structured-filters.js
// npm run benchmark:structured
//
// Benchmark des 10 requetes structurees prioritaires. Pour les requetes
// PUREMENT structurees, la conformite est verifiee MECANIQUEMENT (pas de
// jugement humain necessaire — soit un film respecte le filtre, soit non).
// Isole du moteur principal, aucune ecriture Supabase, aucun Ollama.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { buildGazetteer } = require("./lib/entity-gazetteer");
const { parseStructuredQuery } = require("./lib/structured-query-parser");
const { applyHardFilters, checkCompliance } = require("./lib/hard-filter-retrieval");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");

const QUERIES = [
  "un film avec Russell Crowe",
  "un film avec Russell Crowe datant des annees 2010",
  "un film avec Russell Crowe de moins de 2h",
  "un film des annees 2010 de moins de 2h avec Russell Crowe",
  "un film realise par Clint Eastwood",
  "un film de moins de 90 minutes",
  "un film d'horreur avec Russell Crowe",
  "un thriller des annees 2010 avec Russell Crowe",
  "un film avec Russell Crowe qui parle de vengeance",
  "un film avec Russell Crowe qui fait peur",
  "un film realise par Clint Eastwood datant des annees 2000",
  "un film realise par Clint Eastwood de moins de 2h",
  "un film des annees 2000 de moins de 2h realise par Clint Eastwood",
  "un film realise par Clint Eastwood qui parle de vengeance",
  "un film realise par Clint Eastwood qui fait peur",
];

function run() {
  const catalogPath = process.argv[2] || FINAL_CATALOG_PATH;
  const { movies } = loadCatalog(catalogPath);
  const gazetteer = buildGazetteer(movies);
  console.log(`Catalogue : ${movies.length} films. Gazetteer : ${gazetteer.actorNames.size} acteurs distincts, ${gazetteer.directorNames.size} realisateurs distincts.\n`);

  // Verification prealable : comptage DIRECT dans les donnees, avant tout parsing/filtre.
  const eastwoodDirectCount = movies.filter(m => (m.facts.directors || []).includes("Clint Eastwood")).length;
  console.log(`Comptage direct (facts.directors contient exactement "Clint Eastwood") : ${eastwoodDirectCount} film(s) dans le catalogue.\n`);

  let totalCompliant = 0, totalChecked = 0;

  QUERIES.forEach((q, i) => {
    const parsed = parseStructuredQuery(q, gazetteer);
    const pool = applyHardFilters(movies, parsed.filters);
    console.log(`${"=".repeat(70)}`);
    console.log(`${i + 1}. "${q}"`);
    console.log(`   Filtres extraits : ${JSON.stringify(parsed.filters)}`);
    console.log(`   Reste semantique : "${parsed.semantic_query}"`);
    console.log(`   Films eligibles  : ${pool.length}`);

    // Verification specifique : si la requete filtre UNIQUEMENT sur Clint Eastwood (aucun autre filtre),
    // le pool doit correspondre EXACTEMENT au comptage direct fait plus haut.
    const onlyEastwoodDirector = parsed.filters.directors.length === 1 && parsed.filters.directors[0] === "Clint Eastwood"
      && parsed.filters.actors.length === 0 && parsed.filters.year_min == null && parsed.filters.year_max == null
      && parsed.filters.runtime_min == null && parsed.filters.runtime_max == null && parsed.filters.genres.length === 0;
    if (onlyEastwoodDirector) {
      const matches = pool.length === eastwoodDirectCount;
      console.log(`   VERIFICATION CROISEE : pool (${pool.length}) ${matches ? "==" : "!="} comptage direct (${eastwoodDirectCount}) ${matches ? "— coherent" : "— INCOHERENCE A INVESTIGUER"}`);
    }

    const compliances = pool.map(m => checkCompliance(m, parsed.filters));
    const nonCompliant = compliances.filter(c => !c.compliant);
    totalChecked += compliances.length;
    totalCompliant += compliances.length - nonCompliant.length;

    if (nonCompliant.length > 0) {
      console.log(`   ATTENTION : ${nonCompliant.length} film(s) NON CONFORME(S) dans le pool — bug si ca arrive`);
    } else {
      console.log(`   OK : 100% conformite mecanique verifiee sur ${pool.length} film(s)`);
    }
    pool.forEach(m => console.log(`      - ${m.title} (${m.facts.year || "annee inconnue"}, ${m.facts.runtime_minutes ? m.facts.runtime_minutes + " min" : "duree inconnue"})`));
    console.log("");
  });

  console.log(`${"=".repeat(70)}`);
  console.log(`CONFORMITE GLOBALE : ${totalCompliant}/${totalChecked} (doit etre 100% par construction — sinon bug dans applyHardFilters/checkCompliance)`);
  console.log(`FIN — aucune ecriture Supabase, aucun Ollama, moteur principal non modifie.`);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = { run, QUERIES };