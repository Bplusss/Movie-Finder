#!/usr/bin/env node
// pipeline/test-wikipedia-synopsis-1018.js
// npm run test:wikipedia-synopsis
//
// Test 100% LECTURE SEULE : aucun INSERT/UPDATE/DELETE/ALTER, uniquement des
// SELECT sur Supabase et des appels HTTP vers l'API MediaWiki officielle
// (fr.wikipedia.org / en.wikipedia.org). Mesure la disponibilite d'une
// introduction ET d'une section synopsis/plot, en francais ET en anglais.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const wd = require("./lib/wikidata-api");
const wiki = require("./lib/wikipedia-api");
const sections = require("./lib/wikipedia-sections");

const RESULTS_DIR = path.join(__dirname, "test-results");
const SITELINKS_CACHE_PATH = path.join(RESULTS_DIR, "wikidata-sitelinks-cache.json");
const CONTENT_CACHE_PATH = path.join(RESULTS_DIR, "wikipedia-content-cache.json");
const REPORT_JSON_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || "1018", 10);
const DELAY_MS = 450;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return {}; } }
function saveJson(p, obj) { fs.mkdirSync(RESULTS_DIR, { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

async function withRetry(fn, label, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      const isRateLimit = e.status === 429 || e.status === 503;
      const wait = e.retryAfterMs || (isRateLimit ? 4000 * i : 1500 * i);
      console.warn(`  tentative ${i}/${attempts} echouee pour ${label} (${e.message})${isRateLimit ? ` - attente ${Math.round(wait / 1000)}s` : ""}`);
      if (i === attempts) throw e; // erreur reseau persistante -> jamais confondue avec "pas de contenu"
      await sleep(wait);
    }
  }
}

async function loadFilmsFromSupabase(limit) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL manquant.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // SELECT uniquement. Aucune ecriture nulle part dans ce script.
  const { rows } = await pool.query(
    `select id, wikidata_id, title, wikipedia_url, wikipedia_title_en, year
     from movies where wikidata_id is not null order by wikidata_id limit $1`,
    [limit]
  );
  await pool.end();
  return rows;
}

/** Deduit le titre francais depuis wikipedia_url s'il pointe vers fr.wikipedia.org (lecture seule, rien devine). */
function frTitleFromStoredUrl(url) {
  if (!url || !url.startsWith("https://fr.wikipedia.org/wiki/")) return null;
  const encoded = url.replace("https://fr.wikipedia.org/wiki/", "");
  try { return decodeURIComponent(encoded).replace(/_/g, " "); } catch (e) { return null; }
}

/** Complete les titres FR/EN manquants via les sitelinks Wikidata (lecture seule, jamais devine). */
async function backfillTitlesFromWikidata(films, sitelinksCache) {
  const needing = films.filter(f => {
    const frFromUrl = frTitleFromStoredUrl(f.wikipedia_url);
    return (!frFromUrl && !f.wikipedia_title_en) && !sitelinksCache[f.wikidata_id];
  });
  if (needing.length === 0) return;
  console.log(`Rattrapage sitelinks Wikidata pour ${needing.length} film(s) sans titre Wikipedia connu (lecture seule)...`);

  for (let i = 0; i < needing.length; i += 50) {
    const batch = needing.slice(i, i + 50);
    let entities;
    try {
      entities = await withRetry(() => wd.getEntities(batch.map(f => f.wikidata_id)), `wbgetentities sitelinks [${i}]`, 5);
    } catch (e) { continue; } // retente au prochain lancement, jamais invente
    for (const f of batch) {
      const entity = entities[f.wikidata_id];
      if (entity) sitelinksCache[f.wikidata_id] = wd.extractSitelinkTitles(entity);
    }
    saveJson(SITELINKS_CACHE_PATH, sitelinksCache);
    await sleep(DELAY_MS);
  }
}

async function getContent(title, lang, cache) {
  const key = `${lang}:${title}`;
  if (cache[key]) return cache[key];

  let entry;
  try {
    const json = await withRetry(() => wiki.fetchFullExtractRaw(title, lang), `${lang}wiki "${title}"`);
    const pages = json.query && json.query.pages;
    const page = pages ? Object.values(pages)[0] : null;
    if (!page || page.missing !== undefined) {
      entry = { status: "not_found", found: false };
    } else {
      const fullText = page.extract || "";
      const parsed = sections.parseSections(fullText);
      const synopsisSection = sections.findSynopsisSection(parsed.sections, lang);
      entry = {
        status: "ok", found: true,
        wikipedia_url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((page.title || title).replace(/ /g, "_"))}`,
        intro: parsed.intro || null,
        intro_length: parsed.intro ? parsed.intro.length : 0,
        section_titles: parsed.sections.map(s => s.title),
        synopsis_section_name: synopsisSection ? synopsisSection.title : null,
        synopsis_text: synopsisSection ? synopsisSection.content : null,
        synopsis_length: synopsisSection ? synopsisSection.content.length : 0,
      };
    }
  } catch (e) {
    entry = { status: "network_error", found: false, error: e.message };
  }

  if (entry.status !== "network_error") { cache[key] = entry; saveJson(CONTENT_CACHE_PATH, cache); }
  return entry;
}

function avgLen(arr) { return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0; }
function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }

async function run() {
  console.log(`[Test lecture seule] Chargement de ${SAMPLE_SIZE} films depuis Supabase...`);
  const films = await loadFilmsFromSupabase(SAMPLE_SIZE);
  console.log(`${films.length} films charges. AUCUNE ecriture ne sera faite dans Supabase.`);

  const sitelinksCache = loadJson(SITELINKS_CACHE_PATH);
  await backfillTitlesFromWikidata(films, sitelinksCache);

  const contentCache = loadJson(CONTENT_CACHE_PATH);
  const results = [];
  let processed = 0;

  for (const film of films) {
    const frFromUrl = frTitleFromStoredUrl(film.wikipedia_url);
    const sitelinks = sitelinksCache[film.wikidata_id] || {};
    const titleFr = frFromUrl || sitelinks.fr || null;
    const titleEn = film.wikipedia_title_en || sitelinks.en || null;

    const record = {
      movie_id: film.id, wikidata_id: film.wikidata_id, title: film.title,
      wikipedia_title_fr: titleFr, wikipedia_title_en: titleEn,
      article_used: null, lang_used: null,
      fr: null, en: null,
      intro_available: false, intro_length: 0,
      synopsis_section_name: null, synopsis_available: false, synopsis_length: 0,
      status: null,
    };

    if (!titleFr && !titleEn) {
      record.status = "no_wikipedia_title";
      results.push(record);
      processed++;
      continue;
    }

    if (titleFr) {
      record.fr = await getContent(titleFr, "fr", contentCache);
      await sleep(DELAY_MS);
    }
    if (titleEn) {
      record.en = await getContent(titleEn, "en", contentCache);
      await sleep(DELAY_MS);
    }

    // Priorite FR puis EN (etape 2), mais les deux sont mesures independamment (etape 4).
    const primary = (record.fr && record.fr.status === "ok") ? { lang: "fr", data: record.fr }
      : (record.en && record.en.status === "ok") ? { lang: "en", data: record.en } : null;

    if (primary) {
      record.article_used = primary.data.wikipedia_url;
      record.lang_used = primary.lang;
      record.intro_available = Boolean(primary.data.intro);
      record.intro_length = primary.data.intro_length;
      record.synopsis_section_name = primary.data.synopsis_section_name;
      record.synopsis_available = Boolean(primary.data.synopsis_text);
      record.synopsis_length = primary.data.synopsis_length;
      record.status = "ok";
    } else {
      const anyNetworkError = (record.fr && record.fr.status === "network_error") || (record.en && record.en.status === "network_error");
      record.status = anyNetworkError ? "network_error" : "article_not_found";
    }

    results.push(record);
    processed++;
    if (processed % 25 === 0) console.log(`  ${processed}/${films.length} films traites`);
  }

  saveJson(REPORT_JSON_PATH, results);

  // ================= RAPPORT =================
  const total = results.length;
  const frFound = results.filter(r => r.fr && r.fr.status === "ok").length;
  const enFound = results.filter(r => r.en && r.en.status === "ok").length;
  const noArticle = results.filter(r => r.status === "article_not_found" || r.status === "no_wikipedia_title").length;

  const introFr = results.filter(r => r.fr && r.fr.status === "ok" && r.fr.intro).length;
  const introEn = results.filter(r => r.en && r.en.status === "ok" && r.en.intro).length;
  const atLeastOneIntro = results.filter(r => r.intro_available).length;
  const avgIntroFr = avgLen(results.filter(r => r.fr && r.fr.intro).map(r => r.fr.intro_length));
  const avgIntroEn = avgLen(results.filter(r => r.en && r.en.intro).map(r => r.en.intro_length));

  const synopsisFrCount = results.filter(r => r.fr && r.fr.synopsis_text).length;
  const synopsisEnCount = results.filter(r => r.en && r.en.synopsis_text).length;
  const atLeastOneSynopsis = results.filter(r => r.synopsis_available).length;
  const avgSynopsisFr = avgLen(results.filter(r => r.fr && r.fr.synopsis_text).map(r => r.fr.synopsis_length));
  const avgSynopsisEn = avgLen(results.filter(r => r.en && r.en.synopsis_text).map(r => r.en.synopsis_length));

  const introOnly = results.filter(r => r.intro_available && !r.synopsis_available).length;
  const synopsisOnly = results.filter(r => !r.intro_available && r.synopsis_available).length;
  const both = results.filter(r => r.intro_available && r.synopsis_available).length;
  const neither = results.filter(r => !r.intro_available && !r.synopsis_available).length;
  const atLeastOneEither = results.filter(r => r.intro_available || r.synopsis_available).length;

  console.log(`\n=== RAPPORT WIKIPEDIA — ${total} FILMS ===`);
  console.log(`Films testes : ${total}\n`);
  console.log(`### Articles`);
  console.log(`Articles francais trouves : ${frFound}`);
  console.log(`Articles anglais trouves  : ${enFound}`);
  console.log(`Aucun article trouve      : ${noArticle}\n`);
  console.log(`### Introductions`);
  console.log(`Introductions francaises  : ${introFr}`);
  console.log(`Introductions anglaises   : ${introEn}`);
  console.log(`Au moins une introduction : ${atLeastOneIntro}`);
  console.log(`Longueur moyenne intro FR : ${avgIntroFr} caracteres`);
  console.log(`Longueur moyenne intro EN : ${avgIntroEn} caracteres\n`);
  console.log(`### Sections synopsis`);
  console.log(`Films avec section Synopsis FR      : ${synopsisFrCount}`);
  console.log(`Films avec section Plot/Synopsis EN : ${synopsisEnCount}`);
  console.log(`Au moins une section synopsis        : ${atLeastOneSynopsis}`);
  console.log(`Longueur moyenne synopsis FR : ${avgSynopsisFr} caracteres`);
  console.log(`Longueur moyenne synopsis EN : ${avgSynopsisEn} caracteres\n`);
  console.log(`### Resultat global`);
  console.log(`Introduction uniquement    : ${introOnly}`);
  console.log(`Synopsis uniquement        : ${synopsisOnly}`);
  console.log(`Introduction + synopsis    : ${both}`);
  console.log(`Aucun contenu exploitable  : ${neither}`);
  console.log(`Pourcentage avec synopsis          : ${pct(atLeastOneSynopsis, total)}%`);
  console.log(`Pourcentage avec intro OU synopsis : ${pct(atLeastOneEither, total)}%`);

  console.log(`\n--- 20 exemples avec synopsis trouve ---`);
  results.filter(r => r.synopsis_available).slice(0, 20).forEach(r => {
    const data = r.lang_used === "fr" ? r.fr : r.en;
    console.log(`\n${r.title} (${r.wikidata_id}) — langue: ${r.lang_used} — article: "${r.lang_used === "fr" ? r.wikipedia_title_fr : r.wikipedia_title_en}"`);
    console.log(`  Section: "${r.synopsis_section_name}" — ${r.synopsis_length} caracteres`);
    console.log(`  ${data.synopsis_text.slice(0, 300)}${data.synopsis_text.length > 300 ? "..." : ""}`);
  });

  console.log(`\n--- 10 exemples SANS section synopsis ---`);
  results.filter(r => !r.synopsis_available).slice(0, 10).forEach(r => {
    const data = r.fr && r.fr.status === "ok" ? r.fr : (r.en && r.en.status === "ok" ? r.en : null);
    console.log(`\n${r.title} (${r.wikidata_id}) — statut: ${r.status}`);
    console.log(`  Article trouve: ${data ? "oui" : "non"} — langue: ${r.lang_used || "-"}`);
    console.log(`  Sections disponibles: ${data ? (data.section_titles.join(", ") || "aucune") : "-"}`);
  });

  console.log(`\n=== CONCLUSION ===`);
  console.log(`Sur ${total} films, ${atLeastOneSynopsis} ont un synopsis exploitable (${pct(atLeastOneSynopsis, total)}%).`);
  console.log(`${atLeastOneIntro} ont au moins une introduction exploitable (${pct(atLeastOneIntro, total)}%).`);
  console.log(`${both} ont a la fois introduction ET synopsis (${pct(both, total)}%).`);
  console.log(`\nResultats complets ecrits dans : pipeline/test-results/wikipedia-synopsis-1018.json`);
  console.log(`(fichier local uniquement — rien n'a ete importe dans Supabase)`);
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
