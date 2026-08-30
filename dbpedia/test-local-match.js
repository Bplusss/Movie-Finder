#!/usr/bin/env node
// dbpedia/test-local-match.js
// npm run dbpedia:test-match
//
// POC : mesure la couverture reelle de DBpedia (via les fichiers Databus
// telecharges localement) sur les films deja en base, SANS AUCUN appel HTTP
// individuel a DBpedia et SANS AUCUNE ecriture dans Supabase (lecture seule).
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { streamTriples } = require("./lib/stream-triples");
const matcher = require("./lib/matcher");

const DOWNLOADS_DIR = path.join(__dirname, "downloads");
const REPORT_PATH = path.join(__dirname, "report.json");

function filePathFor(name) {
  const p = path.join(DOWNLOADS_DIR, `${name}.ttl.bz2`);
  return fs.existsSync(p) ? p : null;
}

async function loadFilmsFromSupabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquant.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Lecture seule : aucune ecriture n'est faite dans ce script.
  const { rows } = await pool.query(`select wikidata_id, title from movies where wikidata_id is not null`);
  await pool.end();
  return rows;
}

async function run() {
  console.log("[POC DBpedia local] Chargement des films depuis Supabase (lecture seule)...");
  const films = await loadFilmsFromSupabase();
  console.log(`${films.length} films charges.`);
  const targetWikidataIds = new Set(films.map(f => f.wikidata_id));

  const linksFile = filePathFor("wikidata_links_en");
  const labelsFile = filePathFor("labels_en");
  const abstractsFile = filePathFor("abstracts_en");
  const longAbstractsFile = filePathFor("long_abstracts_en");

  if (!linksFile) console.warn("ATTENTION : fichier de liens Wikidata absent -> aucune correspondance fiable ne sera trouvee, seulement le repli par titre (peu fiable).");
  if (!labelsFile) console.warn("ATTENTION : fichier labels absent -> les labels resteront vides.");
  if (!abstractsFile) console.warn("ATTENTION : fichier abstracts absent -> les resumes resteront vides.");
  if (!longAbstractsFile) console.warn("ATTENTION : fichier long_abstracts absent (peut-etre fusionne avec abstracts dans les versions recentes) -> champ laisse vide, jamais invente.");

  // --- Etape 1 : index Wikidata -> URI DBpedia, filtre a notre ensemble cible ---
  let wikidataIndex = new Map();
  if (linksFile) {
    console.log("Lecture du fichier de liens Wikidata (streaming, filtre a nos films)...");
    const sameAsTriples = [];
    await streamTriples(linksFile, t => sameAsTriples.push(t), {
      onProgress: (lines) => process.stdout.write(`\r  ${(lines / 1e6).toFixed(1)}M lignes lues...`),
    });
    process.stdout.write("\n");
    wikidataIndex = matcher.buildWikidataIndex(sameAsTriples, targetWikidataIds);
    console.log(`${wikidataIndex.size}/${films.length} films ont un lien Wikidata->DBpedia trouve.`);
  }

  const matchedUris = new Set(wikidataIndex.values());

  // --- Etape 2 : labels (necessaires pour le rapport ET le repli par titre) ---
  let labelIndex = new Map();
  if (labelsFile) {
    console.log("Lecture du fichier labels (streaming)...");
    const labelTriples = [];
    // On garde tous les labels dont l'URI est deja matchee, PLUS potentiellement
    // utiles pour le repli par titre -> on ne peut pas filtrer par URI cible ici
    // pour le repli (on ne les connait pas encore), donc on construit un index
    // complet mais borne a la langue "en" pour rester raisonnable en memoire.
    await streamTriples(labelsFile, t => {
      if (t.predicate.endsWith("#label") && t.lang === "en") labelTriples.push(t);
    }, { onProgress: (lines) => process.stdout.write(`\r  ${(lines / 1e6).toFixed(1)}M lignes lues...`) });
    process.stdout.write("\n");
    labelIndex = new Map(labelTriples.map(t => [t.subject, t.object]));
    console.log(`${labelIndex.size} labels anglais charges.`);
  }
  const labelLookup = matcher.buildLabelLookup(labelIndex);

  // --- Etape 3 : abstracts / long_abstracts, filtres aux URIs deja matchees ---
  async function loadAttribute(file, label) {
    if (!file) return new Map();
    console.log(`Lecture du fichier ${label} (streaming, filtre aux URIs deja matchees)...`);
    const triples = [];
    await streamTriples(file, t => {
      if (t.predicate.endsWith("/abstract") && t.lang === "en" && matchedUris.has(t.subject)) triples.push(t);
    }, { onProgress: (lines) => process.stdout.write(`\r  ${(lines / 1e6).toFixed(1)}M lignes lues...`) });
    process.stdout.write("\n");
    return new Map(triples.map(t => [t.subject, t.object]));
  }
  const abstractIndex = await loadAttribute(abstractsFile, "abstracts");
  const longAbstractIndex = await loadAttribute(longAbstractsFile, "long_abstracts");

  // --- Etape 4 : correspondance finale ---
  console.log("Calcul des correspondances...");
  const results = matcher.matchFilms(films, { wikidataIndex, labelIndex, abstractIndex, longAbstractIndex, labelLookup });

  const matched = results.filter(r => r.matched);
  const unmatched = results.filter(r => !r.matched);
  const withAbstract = matched.filter(r => r.abstract);
  const withLongAbstract = matched.filter(r => r.long_abstract);

  const report = {
    generated_at: new Date().toISOString(),
    total_films_tested: films.length,
    matched_count: matched.length,
    with_abstract_count: withAbstract.length,
    with_long_abstract_count: withLongAbstract.length,
    unmatched_count: unmatched.length,
    match_rate_pct: Math.round((matched.length / films.length) * 1000) / 10,
    match_method_breakdown: {
      wikidata_sameas: matched.filter(r => r.match_method === "wikidata_sameas").length,
      title_fallback: matched.filter(r => r.match_method === "title_fallback").length,
    },
    unmatched_reasons_breakdown: unmatched.reduce((acc, r) => { acc[r.reason] = (acc[r.reason] || 0) + 1; return acc; }, {}),
    examples_matched: matched.slice(0, 20),
    examples_unmatched: unmatched.slice(0, 20),
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log(`\n=== RAPPORT (aucune ecriture faite dans Supabase) ===`);
  console.log(`Films testes         : ${report.total_films_tested}`);
  console.log(`Correspondances      : ${report.matched_count} (${report.match_rate_pct}%)`);
  console.log(`  dont via Wikidata  : ${report.match_method_breakdown.wikidata_sameas}`);
  console.log(`  dont via titre     : ${report.match_method_breakdown.title_fallback}`);
  console.log(`Avec abstract        : ${report.with_abstract_count}`);
  console.log(`Avec long_abstract   : ${report.with_long_abstract_count}`);
  console.log(`Sans correspondance  : ${report.unmatched_count}`);
  console.log(`Raisons d'echec      :`, report.unmatched_reasons_breakdown);
  console.log(`\nRapport complet (avec les 20+20 exemples) ecrit dans : dbpedia/report.json`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
