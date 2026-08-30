#!/usr/bin/env node
// pipeline/analyze-feedback.js
// node pipeline/analyze-feedback.js [chemin optionnel vers feedback-log.json]
//
// ANALYSEUR PERMANENT — lecture seule. Ne modifie jamais movie-search-v3.js,
// le ranking, le parseur, les embeddings, ni le fichier de log lui-meme.
// Produit un rapport reproductible : volumes, pertinence, raisons de
// non-pertinence, motifs par famille de requete AVEC SEUILS (jamais de
// "systemique" sur 2-3 avis), detection de films "cameleons" (generique,
// aucun titre code en dur), et separation donnee/moteur pour les avis
// "mauvais acteur/realisateur" (reutilise le parseur/gazetteer reels, ne
// duplique aucune logique).
"use strict";
const fs = require("fs");
const path = require("path");
const { parseStructuredQuery } = require("./lib/structured-query-parser");
const { buildGazetteer } = require("./lib/entity-gazetteer");
const { AMBIANCE_LEXICON } = require("./lib/movie-search-v3");
const { loadCatalog } = require("./lib/local-catalog");

const DEFAULT_LOG_PATH = path.join(__dirname, "test-results", "feedback-log.json");
const DEFAULT_CATALOG_PATH = path.join(__dirname, "test-results", "semantic-enrichment-1018-final.json");

function loadLog(p) {
  if (!fs.existsSync(p)) throw new Error(`Fichier introuvable : ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function avg(nums) { return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null; }
function stddev(nums) {
  if (nums.length < 2) return 0;
  const m = avg(nums);
  return Math.sqrt(nums.reduce((a, n) => a + (n - m) ** 2, 0) / nums.length);
}

function computeVolume(log) {
  const queryCount = {};
  log.forEach(e => { queryCount[e.query] = (queryCount[e.query] || 0) + 1; });
  return {
    totalFeedback: log.length,
    distinctQueries: new Set(log.map(e => e.query)).size,
    distinctFilms: new Set(log.map(e => e.filmId)).size,
    distinctSessions: new Set(log.map(e => e.sessionId).filter(Boolean)).size,
    queriesTestedMultipleTimes: Object.values(queryCount).filter(c => c > 1).length,
  };
}

function computeRelevanceStats(log) {
  const withRel = log.filter(e => e.relevanceRating != null);
  const byPosition = {};
  withRel.forEach(e => { if (e.position != null) { byPosition[e.position] = byPosition[e.position] || []; byPosition[e.position].push(e.relevanceRating); } });
  const avgByPosition = {};
  Object.keys(byPosition).forEach(p => avgByPosition[p] = avg(byPosition[p]));
  const low = withRel.filter(e => e.relevanceRating <= 2).length;
  const high = withRel.filter(e => e.relevanceRating >= 4).length;
  return {
    count: withRel.length,
    avg: avg(withRel.map(e => e.relevanceRating)),
    distribution: [1, 2, 3, 4, 5].reduce((d, v) => { d[v] = withRel.filter(e => e.relevanceRating === v).length; return d; }, {}),
    avgByPosition,
    tauxBasses: withRel.length ? low / withRel.length : null,
    tauxHautes: withRel.length ? high / withRel.length : null,
  };
}

function countReasons(log) {
  const counts = {};
  log.forEach(e => {
    const reasons = e.irrelevanceReasons || (e.irrelevanceReason ? [e.irrelevanceReason] : []);
    reasons.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
  });
  return counts;
}

const CONCRETE_SUBJECT_WORDS = ["braquage", "espace", "prison", "tueur", "enquete", "otage", "espion", "naufrage", "extraterrestre"];
const HISTORICAL_WORDS = ["guerre", "seconde guerre mondiale", "vietnam", "annees 19", "annees 20", "historique", "algerie"];
const NARRATIVE_WORDS = ["quelqu'un doit", "personnage doit", "cherche a", "doit sauver", "doit retrouver", "veut devenir", "recommence sa vie"];
const PSYCH_RELATIONAL_WORDS = ["identite", "confiance", "secret", "accuse", "innocent", "qui il est vraiment", "trahison", "coupable"];

function normalize(s) { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function containsAny(text, words) { return words.some(w => text.includes(normalize(w))); }

function classifyQueryBucket(queryText, gazetteer) {
  const t = normalize(queryText);
  const parsed = parseStructuredQuery(queryText, gazetteer);
  const hasStructured = parsed.filters.actors.length || parsed.filters.directors.length
    || parsed.filters.year_min != null || parsed.filters.year_max != null
    || parsed.filters.runtime_min != null || parsed.filters.runtime_max != null || parsed.filters.genres.length;
  const hasAmbiance = AMBIANCE_LEXICON.some(w => t.includes(normalize(w)));
  const hasHistorical = containsAny(t, HISTORICAL_WORDS);
  const hasConcrete = containsAny(t, CONCRETE_SUBJECT_WORDS);
  const hasNarrative = containsAny(t, NARRATIVE_WORDS);
  const hasPsych = containsAny(t, PSYCH_RELATIONAL_WORDS);

  const semanticHits = [hasAmbiance, hasHistorical, hasConcrete, hasNarrative, hasPsych].filter(Boolean).length;
  if (hasStructured && semanticHits > 0) return "combinee";
  if (hasStructured) return "filtres_structures";
  if (hasPsych) return "psychologique_relationnelle";
  if (hasNarrative) return "narrative";
  if (hasHistorical) return "sujet_historique";
  if (hasConcrete) return "sujet_concret";
  if (hasAmbiance) return "ambiance";
  return "non_classee";
}

function signalLevel(n, distinctQueriesCount) {
  if (n < 5) return { level: "FAIBLE", action: "Ignorer pour l'instant (échantillon insuffisant)" };
  if (n < 10) return { level: "MEDIUM", action: "À SURVEILLER" };
  const reinforced = distinctQueriesCount >= 3;
  return { level: "HIGH", action: reinforced ? "À AUDITER (renforcé — plusieurs reformulations indépendantes)" : "À AUDITER" };
}

function analyzeBuckets(log, gazetteer) {
  const byBucket = {};
  log.forEach(e => {
    if (e.relevanceRating == null) return;
    const bucket = classifyQueryBucket(e.query, gazetteer);
    byBucket[bucket] = byBucket[bucket] || { ratings: [], queries: new Set() };
    byBucket[bucket].ratings.push(e.relevanceRating);
    byBucket[bucket].queries.add(e.query);
  });
  return Object.entries(byBucket).map(([bucket, d]) => {
    const sig = signalLevel(d.ratings.length, d.queries.size);
    return { bucket, count: d.ratings.length, distinctQueries: d.queries.size, avgRelevance: avg(d.ratings), ...sig };
  }).sort((a, b) => (a.avgRelevance ?? 5) - (b.avgRelevance ?? 5));
}

function detectChameleons(log, { minEvals = 5, minQueries = 3, minStddev = 1.2, minRange = 3 } = {}) {
  const byFilm = {};
  log.forEach(e => {
    if (e.relevanceRating == null) return;
    byFilm[e.filmId] = byFilm[e.filmId] || { filmTitle: e.filmTitle, ratings: [], queries: new Set() };
    byFilm[e.filmId].ratings.push(e.relevanceRating);
    byFilm[e.filmId].queries.add(e.query);
  });
  return Object.entries(byFilm)
    .map(([filmId, d]) => ({
      filmId, filmTitle: d.filmTitle, nbEvals: d.ratings.length, nbQueries: d.queries.size,
      avg: avg(d.ratings), stddev: stddev(d.ratings), range: Math.max(...d.ratings) - Math.min(...d.ratings),
    }))
    .filter(f => f.nbEvals >= minEvals && f.nbQueries >= minQueries && f.stddev >= minStddev && f.range >= minRange)
    .sort((a, b) => b.stddev - a.stddev);
}

function diagnoseActorDirectorComplaints(log, gazetteer) {
  const relevant = log.filter(e => (e.irrelevanceReasons || []).includes("Mauvais acteur/réalisateur"));
  return relevant.map(e => {
    const parsed = parseStructuredQuery(e.query, gazetteer);
    const foundSomething = parsed.filters.actors.length > 0 || parsed.filters.directors.length > 0;
    return {
      query: e.query, filmTitle: e.filmTitle,
      diagnosis: foundSomething
        ? "Filtre applique correctement (probablement un vrai probleme de classement semantique, pas de donnee)"
        : "Aucun acteur/realisateur reconnu dans le gazetteer -> PROBABLE TROU DE DONNEE ou nom absent du catalogue (a verifier avec diagnose-gazetteer.js)",
    };
  });
}

function run() {
  const logPath = process.argv[2] || DEFAULT_LOG_PATH;
  const catalogPath = process.argv[3] || DEFAULT_CATALOG_PATH;
  const log = loadLog(logPath);

  let gazetteer = { actorNames: new Map(), directorNames: new Map() };
  try {
    const { movies } = loadCatalog(catalogPath);
    gazetteer = buildGazetteer(movies);
  } catch (e) {
    console.log(`(catalogue introuvable a ${catalogPath} — classification par famille et diagnostic donnee/moteur desactives, seuls les volumes/pertinence/raisons seront calcules)\n`);
  }

  console.log(`=== FEEDBACK ANALYSIS ===`);
  const vol = computeVolume(log);
  console.log(`${vol.totalFeedback} feedbacks`);
  console.log(`${vol.distinctQueries} requêtes distinctes | ${vol.distinctFilms} films évalués | ${vol.distinctSessions} sessions`);
  console.log(`${vol.queriesTestedMultipleTimes} requête(s) testée(s) plusieurs fois\n`);

  const rel = computeRelevanceStats(log);
  console.log(`=== PERTINENCE ===`);
  console.log(`Moyenne globale : ${rel.avg != null ? rel.avg.toFixed(2) : "N/A"} (sur ${rel.count} notes)`);
  console.log(`Distribution : ${JSON.stringify(rel.distribution)}`);
  console.log(`Moyenne par position : ${JSON.stringify(rel.avgByPosition)}`);
  console.log(`Taux de notes 1-2 : ${rel.tauxBasses != null ? (rel.tauxBasses * 100).toFixed(1) + "%" : "N/A"}`);
  console.log(`Taux de notes 4-5 : ${rel.tauxHautes != null ? (rel.tauxHautes * 100).toFixed(1) + "%" : "N/A"}\n`);

  console.log(`=== RAISONS DE NON-PERTINENCE ===`);
  const reasons = countReasons(log);
  Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([r, c]) => console.log(`  ${r} : ${c}`));
  console.log("");

  console.log(`=== STRONG SIGNALS (par famille de requête, seuils appliqués) ===`);
  const buckets = analyzeBuckets(log, gazetteer);
  buckets.forEach(b => {
    console.log(`[${b.level}] ${b.bucket}`);
    console.log(`  ${b.count} évaluation(s) sur ${b.distinctQueries} requête(s) distincte(s) | Pertinence moyenne : ${b.avgRelevance.toFixed(2)}`);
    console.log(`  → ${b.action}\n`);
  });

  console.log(`=== FILMS "CAMÉLÉONS" (détection générique, aucun titre codé en dur) ===`);
  const chameleons = detectChameleons(log);
  if (!chameleons.length) console.log(`  Aucun détecté avec les seuils actuels (≥5 évals, ≥3 requêtes, écart-type≥1.2, amplitude≥3).\n`);
  else chameleons.forEach(c => console.log(`  ${c.filmTitle} — ${c.nbEvals} évals sur ${c.nbQueries} requêtes, moyenne ${c.avg.toFixed(2)}, écart-type ${c.stddev.toFixed(2)}, amplitude ${c.range}`));
  console.log("");

  console.log(`=== DIAGNOSTIC DONNÉE vs MOTEUR ("Mauvais acteur/réalisateur") ===`);
  const diag = diagnoseActorDirectorComplaints(log, gazetteer);
  if (!diag.length) console.log(`  Aucune plainte de ce type dans le log.\n`);
  else diag.forEach(d => console.log(`  "${d.query}" (${d.filmTitle}) → ${d.diagnosis}`));
  console.log("");

  console.log(`=== CAS CONNUS DÉJÀ TRAITÉS ===`);
  console.log(`[RESOLVED] "qui fait rire" → corrigé dans V3.2 (AMBIANCE_LEXICON étendu)`);
  console.log(`[DONNÉE, PAS MOTEUR] Christopher Nolan → directors:[] confirmé, voir audit-director-completeness.js`);

  console.log(`\nFIN — analyse en lecture seule, aucune modification effectuée.`);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = {
  computeVolume, computeRelevanceStats, countReasons, classifyQueryBucket,
  signalLevel, analyzeBuckets, detectChameleons, diagnoseActorDirectorComplaints, run,
};
