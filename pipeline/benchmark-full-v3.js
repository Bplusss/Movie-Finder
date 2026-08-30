#!/usr/bin/env node
// pipeline/benchmark-full-v3.js
// npm run benchmark:v3
//
// Benchmark COMPLET de l'architecture v3 (retrieval->ranking). Reutilise les
// caches d'embeddings deja calcules (synopsis/intro) — aucun recalcul par
// defaut. Isole du moteur principal. Aucune ecriture Supabase, aucun Ollama
// pour le scoring. Metriques SEPAREES : conformite structurelle (mecanique)
// vs qualite du ranking (Precision@5/10, MRR, NDCG@10, ground truth manuel
// uniquement la ou il est explicitement defini — jamais devine).
"use strict";
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { buildGazetteer } = require("./lib/entity-gazetteer");
const { searchV3 } = require("./lib/movie-search-v3");
const { checkCompliance } = require("./lib/hard-filter-retrieval");
const { evaluate } = require("./lib/benchmark-metrics");

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

const STRUCTURED_QUERIES = [
  "un film avec Russell Crowe",
  "un film realise par Clint Eastwood",
  "un film avec Russell Crowe datant des annees 2010",
  "un film realise par Clint Eastwood datant des annees 2000",
  "un film avec Russell Crowe de moins de 2h",
  "un film realise par Clint Eastwood de moins de 2h",
  "un film avec Russell Crowe datant des annees 2010 de moins de 2h",
  "un film d'horreur avec Russell Crowe",
  "un thriller realise par Clint Eastwood",
];

const SEMANTIC_QUERIES = [
  "un film qui se deroule pendant la guerre du Vietnam",
  "un film sur un braquage",
  "un film qui se passe dans l'espace",
  "un film avec une histoire de vengeance",
  "un film ou quelqu'un doit retrouver son enfant",
  "une enquete qui devient dangereuse",
  "un film qui fait peur",
  "quelque chose qui me mette la pression",
  "un film oppressant",
  "je veux quelque chose de feel-good",
];

const HYBRID_QUERIES = [
  "un film avec Russell Crowe qui parle de vengeance",
  "un film avec Russell Crowe qui fait peur",
  "un film realise par Clint Eastwood qui parle de vengeance",
  "un film realise par Clint Eastwood qui fait peur",
  "un thriller avec Russell Crowe",
  "un film des annees 2010 avec Russell Crowe sur une enquete dangereuse",
  "un film de moins de 2h d'horreur qui fait peur",
];

const SEMANTIC_GROUND_TRUTH = {
  "un film qui se deroule pendant la guerre du Vietnam": { relevant: ["Apocalypse Now", "Good Morning, Vietnam"], acceptable: ["JFK", "Ali"] },
  "un film sur un braquage": { relevant: ["Heat", "Point Break", "Sexy Beast", "Hors d'atteinte"], acceptable: ["O'Brother", "Thelma et Louise"] },
  "un film qui se passe dans l'espace": { relevant: ["Solaris", "Star Trek", "Avatar"], acceptable: ["Avengers: Endgame", "X-Men: Dark Phoenix"] },
  "un film avec une histoire de vengeance": { relevant: ["X-Men Origins: Wolverine", "Princess Bride", "Carrie : La Vengeance", "Saw 3", "The Lone Ranger"], acceptable: ["Crying Freeman"] },
};

function printStructuredResult(i, q, r) {
  console.log(`${i + 1}. "${q}"`);
  console.log(`   Filtres : ${JSON.stringify(r.filters)}`);
  console.log(`   Semantique residuel : "${r.semantic_query}"  |  Famille : ${r.family}`);
  console.log(`   Pool eligible : ${r.pool_size}`);
}

async function run() {
  const useRealEmbeddings = process.env.V3_WITH_EMBEDDINGS === "1";

  const { movies } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const catalog = buildTextFields(movies, wikipediaResults);
  const gazetteer = buildGazetteer(catalog);
  console.log(`Catalogue : ${catalog.length} films. Gazetteer : ${gazetteer.actorNames.size} acteurs, ${gazetteer.directorNames.size} realisateurs.\n`);

  let embeddingLookup, queryEmbedFn, cosineSimilarity;
  if (useRealEmbeddings) {
    const embModule = require("./lib/embeddings");
    const embCacheSynopsis = loadJson(EMB_CACHE_SYNOPSIS, {});
    const embCacheIntro = loadJson(EMB_CACHE_INTRO, {});
    embeddingLookup = (field, id) => (field === "intro" ? embCacheIntro : embCacheSynopsis)[id] || null;
    queryEmbedFn = embModule.embed;
    cosineSimilarity = embModule.cosineSimilarity;
    console.log(`Embeddings reels actives (caches reutilises : synopsis=${Object.keys(embCacheSynopsis).length}, intro=${Object.keys(embCacheIntro).length}).\n`);
  } else {
    console.log(`V3_WITH_EMBEDDINGS non defini -> composante embedding a 0 (isole l'effet du filtre dur + lexical seuls). Relancer avec V3_WITH_EMBEDDINGS=1 pour la passe complete.\n`);
  }

  console.log(`${"=".repeat(70)}\nFAMILLE STRUCTUREE — conformite mecanique (100% attendu)\n${"=".repeat(70)}\n`);
  let structCompliant = 0, structTotal = 0;
  for (let i = 0; i < STRUCTURED_QUERIES.length; i++) {
    const q = STRUCTURED_QUERIES[i];
    const r = await searchV3(catalog, gazetteer, q, { embeddingLookup, queryEmbedFn, cosineSimilarity });
    printStructuredResult(i, q, r);
    const compliances = r.ranked.map(x => checkCompliance(x.movie, r.filters));
    const bad = compliances.filter(c => !c.compliant);
    structTotal += compliances.length; structCompliant += compliances.length - bad.length;
    console.log(`   Conformite : ${compliances.length - bad.length}/${compliances.length} ${bad.length ? "— ATTENTION BUG" : "OK"}\n`);
  }

  console.log(`${"=".repeat(70)}\nFAMILLE SEMANTIQUE — qualite du ranking\n${"=".repeat(70)}\n`);
  const semanticMetrics = [];
  for (let i = 0; i < SEMANTIC_QUERIES.length; i++) {
    const q = SEMANTIC_QUERIES[i];
    const r = await searchV3(catalog, gazetteer, q, { embeddingLookup, queryEmbedFn, cosineSimilarity });
    printStructuredResult(i, q, r);
    r.ranked.slice(0, 5).forEach(x => console.log(`      #${x.total} ${x.movie.title} [lex=${x.detail.lexical} emb=${x.detail.embedding}]`));
    const gt = SEMANTIC_GROUND_TRUTH[q];
    if (gt) {
      const m = evaluate(r.ranked.map(x => x.movie.title), gt);
      semanticMetrics.push({ query: q, ...m });
      console.log(`   P@5=${m.precisionAt5.toFixed(2)} P@10=${m.precisionAt10.toFixed(2)} MRR=${m.mrr.toFixed(2)} NDCG@10=${m.ndcgAt10.toFixed(2)}`);
    } else {
      console.log(`   (ground truth non defini pour cette requete — aucune metrique calculee, pas de valeur inventee)`);
    }
    console.log("");
  }

  console.log(`${"=".repeat(70)}\nFAMILLE HYBRIDE — conformite dure + qualite du ranking dans le pool\n${"=".repeat(70)}\n`);
  let hybridCompliant = 0, hybridTotal = 0;
  for (let i = 0; i < HYBRID_QUERIES.length; i++) {
    const q = HYBRID_QUERIES[i];
    const r = await searchV3(catalog, gazetteer, q, { embeddingLookup, queryEmbedFn, cosineSimilarity });
    printStructuredResult(i, q, r);
    const compliances = r.ranked.map(x => checkCompliance(x.movie, r.filters));
    const bad = compliances.filter(c => !c.compliant);
    hybridTotal += compliances.length; hybridCompliant += compliances.length - bad.length;
    console.log(`   Conformite (filtres durs) : ${compliances.length - bad.length}/${compliances.length} ${bad.length ? "— ATTENTION BUG" : "OK"}`);
    r.ranked.slice(0, 5).forEach(x => console.log(`      #${x.total} ${x.movie.title} [lex=${x.detail.lexical} emb=${x.detail.embedding}]`));
    console.log("");
  }

  console.log(`${"=".repeat(70)}\nMETRIQUES GLOBALES (SEPAREES PAR TYPE, comme demande)\n${"=".repeat(70)}`);
  console.log(`\nSTRUCTURE : conformite mecanique = ${structCompliant}/${structTotal} (${structTotal ? (100 * structCompliant / structTotal).toFixed(1) : "N/A"}%)`);
  console.log(`HYBRIDE   : conformite des filtres durs = ${hybridCompliant}/${hybridTotal} (${hybridTotal ? (100 * hybridCompliant / hybridTotal).toFixed(1) : "N/A"}%)`);
  if (semanticMetrics.length) {
    const avg = k => semanticMetrics.reduce((a, r) => a + r[k], 0) / semanticMetrics.length;
    console.log(`SEMANTIQUE (sur ${semanticMetrics.length}/${SEMANTIC_QUERIES.length} requetes avec ground truth) : P@5=${avg("precisionAt5").toFixed(2)} P@10=${avg("precisionAt10").toFixed(2)} MRR=${avg("mrr").toFixed(2)} NDCG@10=${avg("ndcgAt10").toFixed(2)}`);
  } else {
    console.log(`SEMANTIQUE : aucune metrique calculee (ground truth absent pour toutes les requetes testees)`);
  }
  console.log(`\nFIN — aucune ecriture Supabase, aucun Ollama, moteur principal non modifie.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run, STRUCTURED_QUERIES, SEMANTIC_QUERIES, HYBRID_QUERIES, SEMANTIC_GROUND_TRUTH };
