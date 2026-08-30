#!/usr/bin/env node
// pipeline/test-semantic-synopsis-search.js
// npm run test:embeddings-synopsis
//
// POC ISOLE ET REVERSIBLE : compare A. moteur structure (inchange),
// B. recherche synopsis par mots-cles (inchangee), C. recherche synopsis par
// embeddings (nouveau). N'ecrit dans aucun fichier existant du projet — le
// cache d'embeddings est dedie a ce seul POC. Aucun Ollama, aucune ecriture
// Supabase, aucune modification du moteur/parsing/scoring principal.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { search } = require("./lib/semantic-search-engine");
const { searchBySynopsis } = require("./lib/synopsis-search");
const { buildHybridCatalog } = require("./test-hybrid-search"); // reutilise, ne modifie pas ce fichier
const { embed, cosineSimilarity, MODEL_NAME } = require("./lib/embeddings");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
// Cache DEDIE a ce POC uniquement — jamais le cache existant du projet (semantic-cache-1018.json, etc.)
const EMBEDDINGS_CACHE_PATH = path.join(RESULTS_DIR, "embeddings-cache-poc.json");

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

async function run() {
  const { movies } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const hybridCatalog = buildHybridCatalog(movies, wikipediaResults);

  // Les 38 sans synopsis restent dans le catalogue complet (hybridCatalog) pour A/B,
  // mais sont simplement ignores par la partie embeddings (withText).
  const withText = hybridCatalog.filter(m => m.synopsisText && m.synopsisText.trim().length > 0);
  console.log(`${hybridCatalog.length} films au total (catalogue complet, jamais reduit).`);
  console.log(`${withText.length} avec synopsis exploitable pour la recherche embeddings (les ${hybridCatalog.length - withText.length} autres sont simplement ignores ici, jamais supprimes).\n`);

  console.log(`Chargement du modele d'embeddings (${MODEL_NAME})...`);
  console.log(`Premiere execution : telechargement (~120-130 Mo), peut prendre plusieurs minutes. Les executions suivantes reutilisent le cache local de la bibliotheque.\n`);
  await embed("test de chargement"); // force le chargement une fois, avec un message clair avant la boucle

  const cache = loadJson(EMBEDDINGS_CACHE_PATH, {});
  let computed = 0;
  console.log(`Cache d'embeddings existant (POC dedie) : ${Object.keys(cache).length} film(s) deja calcules.`);
  for (const m of withText) {
    if (cache[m.wikidata_id]) continue;
    cache[m.wikidata_id] = await embed(m.synopsisText.slice(0, 2000));
    computed++;
    if (computed % 50 === 0) {
      saveJsonAtomic(EMBEDDINGS_CACHE_PATH, cache);
      console.log(`  ${computed} nouveaux embeddings calcules (${Object.keys(cache).length} au total)...`);
    }
  }
  saveJsonAtomic(EMBEDDINGS_CACHE_PATH, cache);
  console.log(`Embeddings prets : ${Object.keys(cache).length} films dans le cache POC (${EMBEDDINGS_CACHE_PATH}).\n`);

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    console.log(`${"=".repeat(70)}`);
    console.log(`${i + 1}. "${q}"`);
    console.log(`${"=".repeat(70)}`);

    // --- A. STRUCTURE (moteur actuel, totalement inchange) ---
    const structured = search(hybridCatalog, q, { n: 5 });
    console.log(`\nA. STRUCTURE :`);
    if (!structured.top.length) console.log(`   Aucun resultat.`);
    else structured.top.forEach(r => console.log(`   ${r.movie.title} (score ${r.result.total})`));

    // --- B. MOTS-CLES (POC lexical precedent, inchange) ---
    const lexical = searchBySynopsis(withText, q, { n: 5 });
    console.log(`\nB. MOTS-CLES :`);
    if (!lexical.top.length) console.log(`   Aucun resultat.`);
    else lexical.top.forEach(r => console.log(`   ${r.movie.title} (score ${r.score})`));

    // --- C. EMBEDDINGS (nouveau) ---
    const qVec = await embed(q);
    const scored = withText
      .filter(m => cache[m.wikidata_id])
      .map(m => ({ movie: m, sim: cosineSimilarity(qVec, cache[m.wikidata_id]) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 10);
    console.log(`\nC. EMBEDDINGS :`);
    scored.forEach(r => {
      const excerpt = r.movie.synopsisText.replace(/\s+/g, " ").slice(0, 160);
      console.log(`   ${r.movie.title} — similarite ${r.sim.toFixed(3)}`);
      console.log(`      "${excerpt}${r.movie.synopsisText.length > 160 ? "..." : ""}"`);
    });
    console.log("");
  }

  console.log(`${"=".repeat(70)}`);
  console.log(`FIN — aucune ecriture Supabase, aucun Ollama, aucune modification du moteur/parsing/scoring principal.`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run };
