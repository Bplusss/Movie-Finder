#!/usr/bin/env node
// pipeline/test-hybrid-search.js
// npm run test:hybrid-search
//
// POC ISOLE ET REVERSIBLE : joint wikipedia-synopsis-1018.json (texte) et
// semantic-enrichment-1018-final.json (profil/genres/adult_content) EN
// MEMOIRE UNIQUEMENT, pour cette mesure. N'ECRIT AUCUN FICHIER, ne modifie
// rien d'existant. Aucun Ollama, aucun Supabase. Ne remplace pas le moteur
// principal — le compare seulement.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { parseQuery, scoreMovie, search } = require("./lib/semantic-search-engine");
const { passesAdultContentFilter } = require("./lib/adult-content-audit");
const { searchBySynopsis } = require("./lib/synopsis-search");

const QUERIES = [
  "je veux un film de guerre",
  "je veux un film qui fait peur",
  "un film qui se déroule pendant la guerre du Vietnam",
  "un film sur un braquage",
  "un film où quelqu'un doit retrouver son enfant",
  "un film qui me fera vraiment peur",
  "quelque chose qui me mette la pression",
];

/** Jointure EN MEMOIRE uniquement (aucun fichier ecrit). wikipediaResults = wikipedia-synopsis-1018.json. */
function buildHybridCatalog(finalCatalogMovies, wikipediaResults) {
  const byWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  return finalCatalogMovies.map(m => {
    const r = byWikidataId.get(m.wikidata_id);
    const data = r ? (r.lang_used === "fr" ? r.fr : r.en) : null;
    const synopsisText = data ? [data.intro, data.synopsis_text].filter(Boolean).join(" ") : "";
    return { ...m, synopsisText };
  });
}

function fmtStructured(top) {
  return top.slice(0, 5).map(r => `${r.movie.title} (score ${r.result.total}, ${r.result.criteriaEvaluated}/${r.result.criteriaRequested} critere(s))`);
}
function fmtSynopsis(top) {
  return top.slice(0, 5).map(r => `${r.movie.title} (score ${r.score}, mots: ${r.matchedTerms.join(", ")})`);
}
function fmtHybrid(top) {
  return top.slice(0, 5).map(r => `${r.movie.title} (structure ${r.structuredScore}, synopsis ${r.synopsisScore}, combine ${r.combinedScore})`);
}

function run() {
  const RESULTS_DIR = path.join(__dirname, "test-results");
  const finalCatalogPath = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
  const wikipediaPath = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");

  const { movies } = loadCatalog(finalCatalogPath);
  const wikipediaResults = JSON.parse(fs.readFileSync(wikipediaPath, "utf8"));
  const hybridCatalog = buildHybridCatalog(movies, wikipediaResults);
  const withText = hybridCatalog.filter(m => m.synopsisText).length;
  console.log(`Catalogue hybride construit EN MEMOIRE : ${hybridCatalog.length} films, dont ${withText} avec un texte de synopsis exploitable.\n`);

  QUERIES.forEach((q, i) => {
    console.log(`${"=".repeat(70)}`);
    console.log(`${i + 1}. "${q}"`);
    console.log(`${"=".repeat(70)}`);

    // --- A. Moteur structure actuel (INCHANGE) ---
    const parsed = parseQuery(q);
    const structured = search(hybridCatalog, q, { n: 40 });
    console.log(`\nA. STRUCTURE — interpretation : genres obligatoires=[${parsed.required.genres.join(", ")}] moods=[${parsed.moods.join(", ")}] min=${JSON.stringify(parsed.min)} max=${JSON.stringify(parsed.max)}`);
    if (structured.top.length === 0) console.log(`   Aucun resultat structure (aucun critere/genre exploitable).`);
    else fmtStructured(structured.top).forEach(l => console.log(`   ${l}`));

    // --- B. Recherche synopsis pure (nouveau, POC) — filtre adulte conserve, genre obligatoire NON applique ici volontairement pour mesurer le signal texte seul ---
    const safePool = hybridCatalog.filter(passesAdultContentFilter);
    const synopsisResult = searchBySynopsis(safePool, q, { n: 40 });
    console.log(`\nB. SYNOPSIS (POC) — ${synopsisResult.queryTokens.length} mot(s)-cle(s) recherche(s) : [${synopsisResult.queryTokens.join(", ")}]`);
    if (synopsisResult.top.length === 0) console.log(`   Aucune correspondance textuelle trouvee.`);
    else fmtSynopsis(synopsisResult.top).forEach(l => console.log(`   ${l}`));

    // --- C. Hybride : combine les deux scores, sur le pool ayant deja passe les contraintes dures (adulte + genre si demande) ---
    let hardFilteredPool = safePool;
    if (parsed.required.genres.length) {
      hardFilteredPool = hardFilteredPool.filter(m => parsed.required.genres.some(g => (m.facts.genres || []).includes(g)));
    }
    const synOnHardPool = searchBySynopsis(hardFilteredPool, q, { n: hardFilteredPool.length });
    const synScoreMap = new Map(synOnHardPool.top.map(r => [r.movie.wikidata_id, r.score]));
    const hybridScored = hardFilteredPool.map(m => {
      const structScore = scoreMovie(m, parsed).total;
      const synScore = synScoreMap.get(m.wikidata_id) || 0;
      const combinedScore = Math.round(structScore * 0.5 + synScore * 0.5);
      return { movie: m, structuredScore: structScore, synopsisScore: synScore, combinedScore };
    }).sort((a, b) => b.combinedScore - a.combinedScore);
    console.log(`\nC. HYBRIDE (structure 50% + synopsis 50%, sur le pool ayant passe les contraintes dures) :`);
    if (hybridScored.length === 0) console.log(`   Aucun film ne passe les contraintes dures pour cette requete.`);
    else fmtHybrid(hybridScored).forEach(l => console.log(`   ${l}`));

    console.log("");
  });

  console.log(`\n${"=".repeat(70)}`);
  console.log(`FIN — aucun fichier ecrit, aucune modification de l'existant, aucun Ollama/Supabase utilise.`);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = { run, buildHybridCatalog };
