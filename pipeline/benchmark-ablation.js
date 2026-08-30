#!/usr/bin/env node
// pipeline/benchmark-ablation.js
// npm run benchmark:ablation
//
// ETUDE D'ABLATION : chaque variante ne change QU'UN parametre par rapport a
// la baseline. Reutilise les caches d'embeddings deja calcules lors du POC
// precedent (embeddings-cache-v2-synopsis.json, -intro.json) — AUCUN nouveau
// calcul d'embedding necessaire par defaut. N'ecrit dans aucun fichier
// existant, ne modifie pas le moteur de production.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { parseQuery, scoreMovie } = require("./lib/semantic-search-engine");
const { passesAdultContentFilter } = require("./lib/adult-content-audit");
const { queryTokens } = require("./lib/synopsis-search");
const { buildDocumentFrequency, scoreWithIdf } = require("./lib/lexical-rarity");
const { VARIANTS, applyVariant } = require("./lib/ablation-variants");
const { evaluate } = require("./lib/benchmark-metrics");
const { GROUND_TRUTH } = require("./benchmark-retroactive-v2");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const EMB_CACHE_SYNOPSIS = path.join(RESULTS_DIR, "embeddings-cache-v2-synopsis.json");
const EMB_CACHE_INTRO = path.join(RESULTS_DIR, "embeddings-cache-v2-intro.json");
const EMB_CACHE_COMBINED = path.join(RESULTS_DIR, "embeddings-cache-v2-combined.json");

function loadJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; } }

function buildSeparatedCatalog(finalCatalogMovies, wikipediaResults) {
  const byWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  return finalCatalogMovies.map(m => {
    const r = byWikidataId.get(m.wikidata_id);
    const data = r ? (r.lang_used === "fr" ? r.fr : r.en) : null;
    return { ...m, introText: data && data.intro ? data.intro : "", synopsisOnlyText: data && data.synopsis_text ? data.synopsis_text : "" };
  });
}

async function run() {
  const useRealEmbeddings = process.env.ABLATION_WITH_EMBEDDINGS === "1";
  let embedModule = null;
  if (useRealEmbeddings) embedModule = require("./lib/embeddings");

  const { movies } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const catalog = buildSeparatedCatalog(movies, wikipediaResults).filter(passesAdultContentFilter);
  const withSynopsis = catalog.filter(m => m.synopsisOnlyText);

  const dfSynopsis = buildDocumentFrequency(withSynopsis.map(m => m.synopsisOnlyText));
  const N = withSynopsis.length;

  const embCacheSynopsis = loadJson(EMB_CACHE_SYNOPSIS, {});
  const embCacheIntro = loadJson(EMB_CACHE_INTRO, {});
  const embCacheCombined = loadJson(EMB_CACHE_COMBINED, {});
  console.log(`Catalogue : ${catalog.length} films (${withSynopsis.length} avec synopsis).`);
  console.log(`Caches d'embeddings reutilises (aucun recalcul) : synopsis=${Object.keys(embCacheSynopsis).length}, intro=${Object.keys(embCacheIntro).length}, combined=${Object.keys(embCacheCombined).length}.\n`);

  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  const variantMetrics = {};
  for (const name in VARIANTS) variantMetrics[name] = [];

  for (const query in GROUND_TRUTH) {
    const qTokens = queryTokens(query);
    const parsed = parseQuery(query);

    const lexicalScored = withSynopsis
      .map(m => ({ movie: m, ...scoreWithIdf(qTokens, m.synopsisOnlyText, dfSynopsis, N) }))
      .filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    const bestMatchedTerms = lexicalScored.length ? lexicalScored[0].matchedTerms : [];
    const lexicalSynopsisMap = new Map(lexicalScored.map(r => [r.movie.wikidata_id, r.score]));

    const embeddingMaps = { synopsis: new Map(), intro: new Map(), combined: new Map() };
    if (useRealEmbeddings) {
      const qVec = await embedModule.embed(query);
      for (const m of withSynopsis) if (embCacheSynopsis[m.wikidata_id]) embeddingMaps.synopsis.set(m.wikidata_id, Math.round(cosine(qVec, embCacheSynopsis[m.wikidata_id]) * 100));
      for (const m of catalog) if (embCacheIntro[m.wikidata_id]) embeddingMaps.intro.set(m.wikidata_id, Math.round(cosine(qVec, embCacheIntro[m.wikidata_id]) * 100));
      for (const m of catalog) if (embCacheCombined[m.wikidata_id]) embeddingMaps.combined.set(m.wikidata_id, Math.round(cosine(qVec, embCacheCombined[m.wikidata_id]) * 100));
    }

    const queryContext = {
      queryTextLower: query.toLowerCase(), parsedStructured: parsed, bestMatchedTerms,
      dfSynopsis, N, pool: catalog, embeddingMaps, lexicalSynopsisMap,
      structuredScoreFn: (m, p) => scoreMovie(m, p).total,
    };

    for (const variantName in VARIANTS) {
      const result = applyVariant(VARIANTS[variantName], queryContext);
      const rankedTitles = result.ranked.slice(0, 10).map(r => r.title);
      const metrics = evaluate(rankedTitles, GROUND_TRUTH[query]);
      variantMetrics[variantName].push({ query, ...metrics, categories: result.categories });
    }
  }

  if (!process.env.ABLATION_WITH_EMBEDDINGS) {
    console.log("NOTE : ABLATION_WITH_EMBEDDINGS non defini -> composante embedding a 0 pour cette passe (isole donc l'effet du ROUTAGE D'INTENTION et du GENRE seuls, sans le signal embedding). Relancer avec ABLATION_WITH_EMBEDDINGS=1 pour inclure l'embedding reel (plus lent, necessite le modele).\n");
  }

  console.log("=== TABLEAU D'ABLATION (chaque ligne = UN SEUL parametre change vs baseline) ===\n");
  console.log("Variante".padEnd(28) + "P@5".padEnd(8) + "P@10".padEnd(8) + "MRR".padEnd(8) + "NDCG@10");
  for (const variantName in variantMetrics) {
    const rows = variantMetrics[variantName];
    const avg = key => rows.reduce((a, r) => a + r[key], 0) / rows.length;
    console.log(
      variantName.padEnd(28) +
      avg("precisionAt5").toFixed(2).padEnd(8) +
      avg("precisionAt10").toFixed(2).padEnd(8) +
      avg("mrr").toFixed(2).padEnd(8) +
      avg("ndcgAt10").toFixed(2)
    );
  }

  console.log("\n=== DETAIL SUR LES 4 REQUETES EN ECHEC BASELINE (MRR=0) — quelle variante change quoi ===");
  const failingQueries = ["je veux un film qui fait peur", "un film où quelqu'un doit retrouver son enfant", "un film qui me fera vraiment peur", "quelque chose qui me mette la pression"];
  for (const q of failingQueries) {
    console.log(`\n"${q}"`);
    for (const variantName in variantMetrics) {
      const row = variantMetrics[variantName].find(r => r.query === q);
      console.log(`  ${variantName.padEnd(26)} MRR=${row.mrr.toFixed(2)}  categories=[${row.categories.join(",")}]`);
    }
  }

  console.log("\nFIN — aucune ecriture Supabase, aucun Ollama, aucune modification du moteur/parsing/scoring principal.");
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run };
