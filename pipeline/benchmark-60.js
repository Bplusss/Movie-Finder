// pipeline/benchmark-60.js
// npm run benchmark:60
//
// Benchmark de reference (60 requetes, 6 categories x 10). Filtres durs :
// ground truth AUTOMATIQUE (mecanique, depuis les vraies donnees). Semantique :
// ground truth EXPLICITE ci-dessous — rempli UNIQUEMENT ce que je connais
// reellement (issu des runs precedents sur les vraies donnees) ; le reste est
// marque TODO plutot qu'invente. Metriques JAMAIS melangees entre categories.
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

const STRUCTURED = [
  "un film avec Russell Crowe",
  "un film realise par Clint Eastwood",
  "un film avec Russell Crowe datant des annees 2010",
  "un film realise par Clint Eastwood datant des annees 2000",
  "un film avec Russell Crowe de moins de 2h",
  "un film realise par Clint Eastwood de moins de 2h",
  "un film avec Russell Crowe datant des annees 2010 de moins de 2h",
  "un film realise par Clint Eastwood datant des annees 2000 de moins de 2h",
  "un thriller realise par Clint Eastwood",
  "un film d'horreur avec Russell Crowe",
];

const GENRES = [
  "un film d'horreur", "une comedie", "un thriller", "un film de guerre", "un western",
  "un film de science-fiction", "un drame", "une comedie musicale", "un film d'aventure", "un film policier",
];

const SUBJECTS = [
  "un film qui se deroule pendant la guerre du Vietnam",
  "un film sur un braquage",
  "un film qui se passe dans l'espace",
  "un film sur des espions",
  "un film sur une prise d'otages",
  "un film sur la Seconde Guerre mondiale",
  "un film sur un tueur en serie",
  "un film sur la guerre d'Algerie",
  "un film sur des extraterrestres",
  "un film sur un naufrage",
];

const NARRATIVE = [
  "un film avec une histoire de vengeance",
  "un film ou quelqu'un doit retrouver son enfant",
  "une enquete qui devient dangereuse",
  "un homme cherche a se venger",
  "quelqu'un doit sauver sa fille",
  "un personnage doit survivre seul",
  "un braquage qui tourne mal",
  "un heros doit sacrifier quelque chose",
  "une famille se dechire",
  "un personnage decouvre un secret de famille",
];

const AMBIANCE = [
  "un film qui fait peur",
  "quelque chose qui me mette la pression",
  "un film oppressant",
  "je veux quelque chose de feel-good",
  "un film sombre",
  "quelque chose de leger",
  "un film angoissant",
  "un film qui donne une sensation de malaise",
  "un film reconfortant",
  "un film stressant",
];

const HYBRID = [
  "un film avec Russell Crowe qui parle de vengeance",
  "un film avec Russell Crowe qui fait peur",
  "un film realise par Clint Eastwood qui parle de vengeance",
  "un film realise par Clint Eastwood qui fait peur",
  "un thriller avec Russell Crowe",
  "un film des annees 2010 avec Russell Crowe sur une enquete dangereuse",
  "un film de moins de 2h d'horreur qui fait peur",
  "un film realise par Clint Eastwood sombre",
  "un film d'horreur oppressant",
  "un thriller feel-good",
];

const SEMANTIC_GROUND_TRUTH = {
  "un film qui se deroule pendant la guerre du Vietnam": { relevant: ["Apocalypse Now", "Good Morning, Vietnam"], acceptable: ["JFK", "Ali"] },
  "un film sur un braquage": { relevant: ["Heat", "Point Break", "Sexy Beast", "Hors d'atteinte"], acceptable: ["O'Brother", "Thelma et Louise"] },
  "un film qui se passe dans l'espace": { relevant: ["Solaris", "Star Trek", "Avatar"], acceptable: ["Avengers: Endgame", "X-Men: Dark Phoenix"] },
  "un film avec une histoire de vengeance": { relevant: ["X-Men Origins: Wolverine", "Princess Bride", "Carrie : La Vengeance", "Saw 3", "The Lone Ranger"], acceptable: ["Crying Freeman"] },
};

function printPool(label, i, q, r) {
  console.log(`[${label}] ${i + 1}. "${q}"`);
  console.log(`   Filtres : ${JSON.stringify(r.filters)} | Famille : ${r.family} | Pool : ${r.pool_size}`);
}

async function runCategory(label, queries, catalog, gazetteer, opts, { useGroundTruth = false } = {}) {
  let compliant = 0, total = 0, falsePositives = 0;
  const semanticRows = [];
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const r = await searchV3(catalog, gazetteer, q, opts);
    printPool(label, i, q, r);

    const compliances = r.ranked.map(x => checkCompliance(x.movie, r.filters));
    const bad = compliances.filter(c => !c.compliant);
    total += compliances.length; compliant += compliances.length - bad.length;
    falsePositives += bad.length;
    console.log(`   Conformite : ${compliances.length - bad.length}/${compliances.length}`);

    if (useGroundTruth) {
      const gt = SEMANTIC_GROUND_TRUTH[q];
      if (gt) {
        const m = evaluate(r.ranked.map(x => x.movie.title), gt);
        semanticRows.push({ query: q, ...m });
        console.log(`   P@5=${m.precisionAt5.toFixed(2)} P@10=${m.precisionAt10.toFixed(2)} MRR=${m.mrr.toFixed(2)} NDCG@10=${m.ndcgAt10.toFixed(2)}`);
      } else {
        console.log(`   (ground truth TODO — non calcule, jamais invente)`);
      }
    }
    r.ranked.slice(0, 3).forEach(x => console.log(`      #${x.total ?? "-"} ${x.movie.title}`));
    console.log("");
  }
  return { compliant, total, falsePositives, semanticRows };
}

async function run() {
  const useRealEmbeddings = process.env.V3_WITH_EMBEDDINGS === "1";
  const { movies } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const catalog = buildTextFields(movies, wikipediaResults);
  const gazetteer = buildGazetteer(catalog);
  console.log(`Catalogue : ${catalog.length} films. Baseline figee — voir pipeline/BASELINE-SNAPSHOT.md.\n`);

  let opts = {};
  if (useRealEmbeddings) {
    const embModule = require("./lib/embeddings");
    const embCacheSynopsis = loadJson(EMB_CACHE_SYNOPSIS, {});
    const embCacheIntro = loadJson(EMB_CACHE_INTRO, {});
    opts = {
      embeddingLookup: (field, id) => (field === "intro" ? embCacheIntro : embCacheSynopsis)[id] || null,
      queryEmbedFn: embModule.embed, cosineSimilarity: embModule.cosineSimilarity,
    };
  }

  const results = {};
  results.STRUCTURED = await runCategory("STRUCTURE", STRUCTURED, catalog, gazetteer, opts);
  results.GENRES = await runCategory("GENRE", GENRES, catalog, gazetteer, opts);
  results.SUBJECTS = await runCategory("SUJET", SUBJECTS, catalog, gazetteer, opts, { useGroundTruth: true });
  results.NARRATIVE = await runCategory("NARRATIF", NARRATIVE, catalog, gazetteer, opts, { useGroundTruth: true });
  results.AMBIANCE = await runCategory("AMBIANCE", AMBIANCE, catalog, gazetteer, opts, { useGroundTruth: true });
  results.HYBRID = await runCategory("HYBRIDE", HYBRID, catalog, gazetteer, opts, { useGroundTruth: true });

  console.log(`${"=".repeat(70)}\nMÉTRIQUES FINALES — SÉPARÉES PAR CATÉGORIE, JAMAIS MÉLANGÉES\n${"=".repeat(70)}\n`);
  for (const cat in results) {
    const r = results[cat];
    console.log(`${cat} : conformite ${r.compliant}/${r.total} (${r.total ? (100 * r.compliant / r.total).toFixed(1) : "N/A"}%), faux positifs structurels = ${r.falsePositives}`);
    if (r.semanticRows.length) {
      const avg = k => r.semanticRows.reduce((a, x) => a + x[k], 0) / r.semanticRows.length;
      console.log(`   Ranking (sur ${r.semanticRows.length} requetes avec ground truth) : P@5=${avg("precisionAt5").toFixed(2)} P@10=${avg("precisionAt10").toFixed(2)} MRR=${avg("mrr").toFixed(2)} NDCG@10=${avg("ndcgAt10").toFixed(2)}`);
    }
  }
  console.log(`\nFIN — aucune ecriture Supabase, aucun Ollama, moteur principal (movie-search-v3.js) non modifie.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run, STRUCTURED, GENRES, SUBJECTS, NARRATIVE, AMBIANCE, HYBRID, SEMANTIC_GROUND_TRUTH };
