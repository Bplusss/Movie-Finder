#!/usr/bin/env node
// pipeline/test-search-1018.js
// npm run test:search-1018
//
// Test COMPLET du moteur de recherche local, isole (server/engine.js et
// index.html ne sont PAS touches). Utilise semantic-enrichment-1018-final.json.
// Aucune ecriture Supabase, aucun appel Ollama.
"use strict";
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { search } = require("./lib/semantic-search-engine");
const { classify } = require("./lib/adult-content-audit");

const QUERIES = [
  "Je veux un film drôle pour ce soir",
  "Un thriller très tendu et sombre",
  "Un film d'action mais pas trop violent",
  "Quelque chose de chaleureux à regarder en famille",
  "Un film romantique mais pas trop triste",
  "Un film complexe qui fait réfléchir",
  "Un film avec beaucoup d'action et peu de romance",
  "Un film sombre, violent et intense",
  "Je veux quelque chose de léger et feel-good",
  "Un film mystérieux et intelligent",
];

function fmtVal(v) { return v === null || v === undefined ? "null" : v; }

function run() {
  const catalogPath = process.argv[2] || path.join(__dirname, "test-results", "semantic-enrichment-1018-final.json");
  console.log(`Chargement du catalogue local depuis : ${catalogPath}\n`);

  const { movies, stats } = loadCatalog(catalogPath);

  console.log(`=== RAPPORT DE CHARGEMENT ===`);
  console.log(`Films charges              : ${stats.total}`);
  console.log(`Doublons de wikidata_id    : ${stats.duplicateCount}${stats.duplicateCount ? " -> " + stats.duplicateWikidataIds.join(", ") : ""}`);
  console.log(`Profils structurellement invalides : ${stats.invalidProfileCount}`);
  console.log(`Films avec profil semantique reussi : ${stats.withSemanticProfile}`);

  // --- Audit adulte complet : confirmed / suspect / safe (cf. adult-content-audit.js) ---
  const classifications = movies.map(m => ({ movie: m, ...classify(m) }));
  const confirmed = classifications.filter(c => c.category === "confirmed");
  const suspect = classifications.filter(c => c.category === "suspect");
  console.log(`\n=== AUDIT CONTENU ADULTE ===`);
  console.log(`adult_content.flagged (ancien heuristique brut) : ${movies.filter(m => m.adult_content && m.adult_content.flagged).length}`);
  console.log(`confirmed (signal titre OU profil semantique — EXCLUS de la recherche) : ${confirmed.length}`);
  console.log(`suspect (signal texte brut seul — PAS exclus, a verifier manuellement) : ${suspect.length}`);
  console.log(`safe : ${classifications.length - confirmed.length - suspect.length}`);
  if (confirmed.length) {
    console.log(`\nListe CONFIRMED (exclus) :`);
    confirmed.forEach(c => console.log(`  - ${c.movie.title} (${c.movie.wikidata_id}) — ${c.reasons.join(" ; ")}`));
  }
  if (suspect.length) {
    console.log(`\nListe SUSPECT (non exclus, a verifier manuellement) :`);
    suspect.forEach(c => console.log(`  - ${c.movie.title} (${c.movie.wikidata_id}) — ${c.reasons.join(" ; ")}`));
  }

  console.log(`\n\n=== RESULTATS DES 10 REQUETES DE TEST ===`);
  QUERIES.forEach((q, i) => {
    const { parsed, excludedAdultCount, excludedByGenre, top } = search(movies, q, { n: 10 });
    console.log(`\n${"=".repeat(70)}`);
    console.log(`${i + 1}. "${q}"`);
    console.log(`   Interpretation : genre(s) OBLIGATOIRE(S)=[${parsed.required.genres.join(", ")}] moods=[${parsed.moods.join(", ")}] min=${JSON.stringify(parsed.min)} max=${JSON.stringify(parsed.max)}`);
    console.log(`   Exclus par le filtre adulte : ${excludedAdultCount} | Exclus car genre obligatoire absent : ${excludedByGenre}`);
    console.log(`${"=".repeat(70)}`);

    top.forEach((r, rank) => {
      const m = r.movie;
      const p = m.semantic_profile || {};
      const coverage = r.result.criteriaRequested ? `${r.result.criteriaEvaluated}/${r.result.criteriaRequested} critere(s) evalue(s)` : "";
      console.log(`\n#${rank + 1} ${m.title} (${m.facts.year || "?"}) — score ${r.result.total}/100 (${coverage})`);
      if (r.result.contributions.length === 0) {
        console.log(`   (aucun critere evaluable — ${r.result.note || ""})`);
      } else {
        r.result.contributions.forEach(c => console.log(`   ${c.critere} = ${fmtVal(c.valeur)} (${typeof c.points === "number" ? c.points.toFixed(1) : c.points} pts)`));
      }
      console.log(`   Moods: ${(p.moods || []).join(", ") || "—"} | Tone: ${(p.tone || []).join(", ") || "—"}`);
      console.log(`   Themes: ${(p.themes || []).join(", ") || "—"} | Keywords: ${(p.keywords || []).join(", ") || "—"}`);
    });
  });

  console.log(`\n\n=== FIN DU TEST — aucune ecriture Supabase, aucun appel Ollama, aucune modification de l'existant ===`);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = { run };
