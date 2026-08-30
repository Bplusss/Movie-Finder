#!/usr/bin/env node
// pipeline/experiment-embedding-vs-baseline.js
// npm run experiment:embedding
//
// UNE experimentation isolee : A (baseline actuelle, movie-search-v3.js
// IMPORTE et INCHANGE) vs B (embedding independant pur, sur synopsis) vs
// C (embedding independant pur, sur intro — teste uniquement parce que la
// famille ambiance en a montre le besoin precedemment, pas une variante
// ajoutee sans raison). Reutilise les caches d'embeddings existants, aucun
// recalcul. N'ecrit ni Supabase, ni catalogue, ni Ollama. Ground truth
// REUTILISE tel quel depuis benchmark-60.js (jamais duplique ni invente).
"use strict";
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { buildGazetteer } = require("./lib/entity-gazetteer");
const { searchV3 } = require("./lib/movie-search-v3"); // BASELINE — importee, jamais modifiee
const { evaluate } = require("./lib/benchmark-metrics");
const { SUBJECTS, NARRATIVE, AMBIANCE, SEMANTIC_GROUND_TRUTH } = require("./benchmark-60"); // reutilise tel quel

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const EMB_CACHE_SYNOPSIS = path.join(RESULTS_DIR, "embeddings-cache-v2-synopsis.json");
const EMB_CACHE_INTRO = path.join(RESULTS_DIR, "embeddings-cache-v2-intro.json");

function loadJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; } }
function buildTextFields(finalCatalogMovies, wikipediaResults) {
  const byWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  return finalCatalogMovies.map(m => {
    const r = byWikidataId.get(m.wikidata_id);
    const data = r ? (r.lang_used === "fr" ? r.fr : r.en) : null;
    return { ...m, introText: data && data.intro ? data.intro : "", synopsisOnlyText: data && data.synopsis_text ? data.synopsis_text : "" };
  });
}

const SEMANTIC_QUERIES = [...SUBJECTS, ...NARRATIVE, ...AMBIANCE];

/** B/C — embedding INDEPENDANT pur : aucun lexical, aucun poids de famille, une seule representation textuelle. */
async function pureEmbeddingRanking(catalog, queryText, { field, embeddingLookup, queryEmbedFn, cosineSimilarity, n = 10 }) {
  const qVec = await queryEmbedFn(queryText);
  const scored = catalog
    .map(m => {
      const vec = embeddingLookup(field, m.wikidata_id);
      return vec ? { movie: m, total: Math.round(cosineSimilarity(qVec, vec) * 100) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);
  return scored.slice(0, n);
}

async function run() {
  const { movies } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const catalog = buildTextFields(movies, wikipediaResults);
  const gazetteer = buildGazetteer(catalog);

  const embModule = require("./lib/embeddings");
  const embCacheSynopsis = loadJson(EMB_CACHE_SYNOPSIS, {});
  const embCacheIntro = loadJson(EMB_CACHE_INTRO, {});
  const embeddingLookup = (field, id) => (field === "intro" ? embCacheIntro : embCacheSynopsis)[id] || null;
  const queryEmbedFn = embModule.embed;
  const cosineSimilarity = embModule.cosineSimilarity;
  console.log(`Catalogue : ${catalog.length} films. Caches reutilises (aucun recalcul) : synopsis=${Object.keys(embCacheSynopsis).length}, intro=${Object.keys(embCacheIntro).length}.\n`);

  const results = { A: [], B: [], C: [] };

  for (const q of SEMANTIC_QUERIES) {
    console.log(`${"=".repeat(70)}\n"${q}"\n${"=".repeat(70)}`);
    const gt = SEMANTIC_GROUND_TRUTH[q];

    const rA = await searchV3(catalog, gazetteer, q, { embeddingLookup, queryEmbedFn, cosineSimilarity });
    const titlesA = rA.ranked.map(x => x.movie.title);
    console.log(`A. BASELINE (famille: ${rA.family}) :`);
    titlesA.slice(0, 5).forEach((t, i) => console.log(`   #${i + 1} ${t}`));

    const rB = await pureEmbeddingRanking(catalog, q, { field: "synopsis", embeddingLookup, queryEmbedFn, cosineSimilarity });
    const titlesB = rB.map(x => x.movie.title);
    console.log(`B. EMBEDDING INDEPENDANT (synopsis) :`);
    titlesB.slice(0, 5).forEach((t, i) => console.log(`   #${i + 1} ${t}`));

    const rC = await pureEmbeddingRanking(catalog, q, { field: "intro", embeddingLookup, queryEmbedFn, cosineSimilarity });
    const titlesC = rC.map(x => x.movie.title);
    console.log(`C. EMBEDDING INDEPENDANT (intro) :`);
    titlesC.slice(0, 5).forEach((t, i) => console.log(`   #${i + 1} ${t}`));

    if (gt) {
      const mA = evaluate(titlesA, gt), mB = evaluate(titlesB, gt), mC = evaluate(titlesC, gt);
      console.log(`\n   METRIQUES :`);
      console.log(`   A (baseline)  : P@5=${mA.precisionAt5.toFixed(2)} P@10=${mA.precisionAt10.toFixed(2)} MRR=${mA.mrr.toFixed(2)} NDCG@10=${mA.ndcgAt10.toFixed(2)}`);
      console.log(`   B (emb synop) : P@5=${mB.precisionAt5.toFixed(2)} P@10=${mB.precisionAt10.toFixed(2)} MRR=${mB.mrr.toFixed(2)} NDCG@10=${mB.ndcgAt10.toFixed(2)}`);
      console.log(`   C (emb intro) : P@5=${mC.precisionAt5.toFixed(2)} P@10=${mC.precisionAt10.toFixed(2)} MRR=${mC.mrr.toFixed(2)} NDCG@10=${mC.ndcgAt10.toFixed(2)}`);
      results.A.push({ query: q, ...mA }); results.B.push({ query: q, ...mB }); results.C.push({ query: q, ...mC });
    } else {
      console.log(`\n   ground truth TODO — aucune metrique calculee`);
    }
    console.log("");
  }

  const spaceQuery = "un film qui se passe dans l'espace";
  if (SEMANTIC_QUERIES.includes(spaceQuery)) {
    console.log(`${"=".repeat(70)}\nTEST SPECIFIQUE OBLIGATOIRE : "${spaceQuery}"\n${"=".repeat(70)}`);
    const rA = await searchV3(catalog, gazetteer, spaceQuery, { embeddingLookup, queryEmbedFn, cosineSimilarity });
    const rB = await pureEmbeddingRanking(catalog, spaceQuery, { field: "synopsis", embeddingLookup, queryEmbedFn, cosineSimilarity });
    const posA127 = rA.ranked.findIndex(x => x.movie.title.includes("127 Heures")) + 1;
    const posB127 = rB.findIndex(x => x.movie.title.includes("127 Heures")) + 1;
    console.log(`Position de "127 Heures" en A (baseline) : ${posA127 || "absent du top 10"}`);
    console.log(`Position de "127 Heures" en B (embedding) : ${posB127 || "absent du top 10"}`);
    console.log(`Attendu si l'hypothese se confirme sur les vraies donnees : B doit reculer 127 Heures apres les vrais films d'espace.\n`);
  }

  console.log(`${"=".repeat(70)}\nMOYENNES SUR LES REQUETES AVEC GROUND TRUTH (${results.A.length}/${SEMANTIC_QUERIES.length})\n${"=".repeat(70)}`);
  for (const label of ["A", "B", "C"]) {
    const rows = results[label];
    if (!rows.length) continue;
    const avg = k => rows.reduce((a, r) => a + r[k], 0) / rows.length;
    console.log(`${label} : P@5=${avg("precisionAt5").toFixed(2)} P@10=${avg("precisionAt10").toFixed(2)} MRR=${avg("mrr").toFixed(2)} NDCG@10=${avg("ndcgAt10").toFixed(2)}`);
  }
  console.log(`\nFIN — aucune ecriture Supabase, aucun Ollama, aucune modification de movie-search-v3.js ni du moteur principal.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run, SEMANTIC_QUERIES };
