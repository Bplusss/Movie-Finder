#!/usr/bin/env node
// pipeline/test-hybrid-ranking-v2.js
// npm run test:hybrid-ranking-v2
//
// POC ISOLE ET REVERSIBLE : compare lexical seul (pondere IDF, sur synopsis
// ET separement sur intro), embeddings seuls (synopsis seul, intro seul,
// intro+synopsis), et une fusion hybride pilotee par detection d'intention.
// N'ecrit dans AUCUN fichier existant (cache dedie a ce POC). Aucun Ollama,
// aucune ecriture Supabase, aucune modification du moteur/parsing/scoring
// principal. Le catalogue des 1018 films reste complet (les 38 sans
// synopsis sont ignores par les composantes texte, jamais supprimes).
"use strict";
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { parseQuery, scoreMovie, search } = require("./lib/semantic-search-engine");
const { passesAdultContentFilter } = require("./lib/adult-content-audit");
const { queryTokens } = require("./lib/synopsis-search");
const { buildDocumentFrequency, scoreWithIdf } = require("./lib/lexical-rarity");
const { detectIntent, computeWeights } = require("./lib/intent-detection");
const { embed, cosineSimilarity, MODEL_NAME } = require("./lib/embeddings");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
// Caches DEDIES a ce POC v2 uniquement (distincts du POC embeddings precedent, car les
// textes indexes different : ici synopsis SEUL, intro SEUL, et combine, separement)
const EMB_CACHE_SYNOPSIS = path.join(RESULTS_DIR, "embeddings-cache-v2-synopsis.json");
const EMB_CACHE_INTRO = path.join(RESULTS_DIR, "embeddings-cache-v2-intro.json");
const EMB_CACHE_COMBINED = path.join(RESULTS_DIR, "embeddings-cache-v2-combined.json");

const QUERIES = [
  "je veux un film de guerre",
  "je veux un film qui fait peur",
  "un film qui se déroule pendant la guerre du Vietnam",
  "un film sur un braquage",
  "un film où quelqu'un doit retrouver son enfant",
  "un film qui me fera vraiment peur",
  "quelque chose qui me mette la pression",
  "un film sur des soldats américains au Vietnam",
  "un film de braquage qui tourne mal",
  "un film où la tension monte progressivement",
  "un film avec une histoire de vengeance",
  "un film qui se passe dans l'espace",
];

function loadJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; } }
function saveJsonAtomic(p, obj) { const tmp = `${p}.tmp`; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, p); }

/** Jointure EN MEMOIRE — garde intro et synopsis_text SEPARES (pas combines aveuglement). */
function buildSeparatedCatalog(finalCatalogMovies, wikipediaResults) {
  const byWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  return finalCatalogMovies.map(m => {
    const r = byWikidataId.get(m.wikidata_id);
    const data = r ? (r.lang_used === "fr" ? r.fr : r.en) : null;
    return {
      ...m,
      introText: data && data.intro ? data.intro : "",
      synopsisOnlyText: data && data.synopsis_text ? data.synopsis_text : "",
    };
  });
}

async function ensureEmbeddings(items, textField, cachePath, label) {
  const cache = loadJson(cachePath, {});
  let computed = 0;
  for (const m of items) {
    const text = m[textField];
    if (!text) continue; // les films sans texte pour ce champ sont ignores, jamais supprimes du catalogue
    if (cache[m.wikidata_id]) continue;
    cache[m.wikidata_id] = await embed(text.slice(0, 2000));
    computed++;
    if (computed % 100 === 0) { saveJsonAtomic(cachePath, cache); console.log(`    [${label}] ${computed} nouveaux embeddings calcules...`); }
  }
  saveJsonAtomic(cachePath, cache);
  console.log(`  [${label}] ${Object.keys(cache).length} embeddings prets.`);
  return cache;
}

function embeddingRanking(items, qVec, cache, textField, n = 10) {
  return items
    .filter(m => cache[m.wikidata_id])
    .map(m => ({ movie: m, sim: cosineSimilarity(qVec, cache[m.wikidata_id]) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, n);
}

async function run() {
  const { movies } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const catalog = buildSeparatedCatalog(movies, wikipediaResults);
  const safeCatalog = catalog.filter(passesAdultContentFilter);

  const withSynopsis = safeCatalog.filter(m => m.synopsisOnlyText);
  const withIntro = safeCatalog.filter(m => m.introText);
  console.log(`${catalog.length} films au total (catalogue complet, jamais reduit).`);
  console.log(`${withSynopsis.length} avec synopsis_text exploitable, ${withIntro.length} avec intro exploitable (composantes texte ignorent le reste sans le supprimer).\n`);

  // --- Corpus IDF distincts pour synopsis et intro (des textes differents ont des frequences differentes) ---
  const dfSynopsis = buildDocumentFrequency(withSynopsis.map(m => m.synopsisOnlyText));
  const dfIntro = buildDocumentFrequency(withIntro.map(m => m.introText));

  console.log(`Chargement du modele d'embeddings (${MODEL_NAME})...`);
  await embed("test de chargement");
  console.log(`Calcul des embeddings (3 variantes : synopsis seul, intro seul, intro+synopsis) — plus long que le POC precedent, prevoir du temps.\n`);
  const embSynopsis = await ensureEmbeddings(withSynopsis, "synopsisOnlyText", EMB_CACHE_SYNOPSIS, "synopsis seul");
  const embIntro = await ensureEmbeddings(withIntro, "introText", EMB_CACHE_INTRO, "intro seul");
  const combinedItems = safeCatalog.map(m => ({ ...m, combinedText: [m.introText, m.synopsisOnlyText].filter(Boolean).join(" ") })).filter(m => m.combinedText);
  const embCombined = await ensureEmbeddings(combinedItems, "combinedText", EMB_CACHE_COMBINED, "intro+synopsis");
  console.log("");

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    const qTokens = queryTokens(q);
    console.log(`${"=".repeat(70)}`);
    console.log(`${i + 1}. "${q}"`);
    console.log(`${"=".repeat(70)}`);

    // --- Lexical IDF sur synopsis (signal principal narratif demande) ---
    const lexicalSynopsisScored = withSynopsis
      .map(m => ({ movie: m, ...scoreWithIdf(qTokens, m.synopsisOnlyText, dfSynopsis, withSynopsis.length) }))
      .filter(r => r.score > 0).sort((a, b) => b.score - a.score);
    const bestAvgIdf = lexicalSynopsisScored.length ? lexicalSynopsisScored[0].avgIdf : 0;

    // --- Lexical IDF sur intro (signal secondaire) ---
    const lexicalIntroScored = withIntro
      .map(m => ({ movie: m, ...scoreWithIdf(qTokens, m.introText, dfIntro, withIntro.length) }))
      .filter(r => r.score > 0).sort((a, b) => b.score - a.score);

    // --- Structure (moteur principal, inchange) ---
    const parsed = parseQuery(q);

    // --- Detection d'intention + poids ---
    const categories = detectIntent(parsed, bestAvgIdf);
    const weights = computeWeights(categories);
    console.log(`\nIntention detectee : [${categories.join(", ")}]  ->  poids : structure=${weights.structured} lexical=${weights.lexical} intro=${weights.intro} embedding=${weights.embedding}`);

    // --- 1. LEXICAL SEUL (synopsis), pour reference/comparaison ---
    console.log(`\n1. LEXICAL SEUL (synopsis, pondere IDF) — top 5 :`);
    if (!lexicalSynopsisScored.length) console.log("   Aucun resultat.");
    else lexicalSynopsisScored.slice(0, 5).forEach(r => console.log(`   ${r.movie.title} (score ${r.score}, avgIdf ${r.avgIdf.toFixed(2)}, mots: ${r.matchedTerms.join(", ")})`));

    // --- 2. EMBEDDINGS SEULS : 3 variantes comparees ---
    const qVecSynopsis = await embed(q);
    const embSynopsisTop = embeddingRanking(withSynopsis, qVecSynopsis, embSynopsis, null, 5);
    const embIntroTop = embeddingRanking(withIntro, qVecSynopsis, embIntro, null, 5);
    const embCombinedTop = embeddingRanking(combinedItems, qVecSynopsis, embCombined, null, 5);
    console.log(`\n2a. EMBEDDINGS sur SYNOPSIS SEUL — top 5 :`);
    embSynopsisTop.forEach(r => console.log(`   ${r.movie.title} (similarite ${r.sim.toFixed(3)})`));
    console.log(`\n2b. EMBEDDINGS sur INTRO SEUL — top 5 :`);
    embIntroTop.forEach(r => console.log(`   ${r.movie.title} (similarite ${r.sim.toFixed(3)})`));
    console.log(`\n2c. EMBEDDINGS sur INTRO+SYNOPSIS COMBINE — top 5 :`);
    embCombinedTop.forEach(r => console.log(`   ${r.movie.title} (similarite ${r.sim.toFixed(3)})`));

    // --- 3. HYBRIDE : combine structure + lexical(synopsis) + intro(secondaire) + embedding(synopsis) selon les poids detectes ---
    const lexMap = new Map(lexicalSynopsisScored.map(r => [r.movie.wikidata_id, r.score]));
    const introMap = new Map(lexicalIntroScored.map(r => [r.movie.wikidata_id, r.score]));
    const embMap = new Map(embSynopsisTop.length || true ? withSynopsis.filter(m => embSynopsis[m.wikidata_id]).map(m => [m.wikidata_id, Math.round(cosineSimilarity(qVecSynopsis, embSynopsis[m.wikidata_id]) * 100)]) : []);

    let pool = safeCatalog;
    if (parsed.required.genres.length) pool = pool.filter(m => parsed.required.genres.some(g => (m.facts.genres || []).includes(g)));

    const hybridScored = pool.map(m => {
      const structScore = scoreMovie(m, parsed).total;
      const lexScore = lexMap.get(m.wikidata_id) || 0;
      const introScore = introMap.get(m.wikidata_id) || 0;
      const embScore = embMap.get(m.wikidata_id) || 0;
      const combined = Math.round(structScore * weights.structured + lexScore * weights.lexical + introScore * weights.intro + embScore * weights.embedding);
      const justification = [];
      if (structScore > 0) justification.push(`structure=${structScore}`);
      if (lexScore > 0) justification.push(`lexical(synopsis)=${lexScore}`);
      if (introScore > 0) justification.push(`lexical(intro)=${introScore}`);
      if (embScore > 0) justification.push(`embedding=${embScore}`);
      return { movie: m, structScore, lexScore, introScore, embScore, combined, justification: justification.join(", ") || "aucun signal" };
    }).sort((a, b) => b.combined - a.combined);

    console.log(`\n3. HYBRIDE (poids pilotes par l'intention detectee) — top 10 :`);
    hybridScored.slice(0, 10).forEach((r, rank) => {
      console.log(`   #${rank + 1} ${r.movie.title} — combine ${r.combined} [${r.justification}]`);
    });

    console.log("");
  }

  console.log(`${"=".repeat(70)}`);
  console.log(`FIN — aucune ecriture Supabase, aucun Ollama, aucune modification du moteur/parsing/scoring principal.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run, buildSeparatedCatalog };
