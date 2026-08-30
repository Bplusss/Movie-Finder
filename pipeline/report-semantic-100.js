#!/usr/bin/env node
// pipeline/report-semantic-100.js
// npm run report:semantic-100
"use strict";
const fs = require("fs");
const path = require("path");
const { runQuery } = require("./lib/semantic-search");
const { SCORE_FIELDS } = require("./lib/semantic-profile");

const OUTPUT_PATH = path.join(__dirname, "test-results", "semantic-enrichment-100.json");

const QUERIES = [
  "Je veux un film drôle et léger pour regarder avec ma copine ce soir",
  "Un thriller sombre avec beaucoup de suspense",
  "Un film d'action pas trop violent",
  "Un film français drôle des années 2010",
  "Un film émouvant mais pas déprimant",
  "Un film de moins de 2 heures",
  "Un film avec Russell Crowe",
  "Un film familial pour regarder avec des enfants",
  "Un film de science-fiction qui fait réfléchir",
  "Un film romantique mais pas trop gnangnan",
];

function avg(arr) { return arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0; }

function run() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    throw new Error(`${OUTPUT_PATH} introuvable — lance d'abord "npm run enrich:semantic-100".`);
  }
  const all = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  const ok = all.filter(r => r.status === "ok");
  const withIntro = all.filter(r => r.source && r.source.has_intro).length;
  const withSynopsis = all.filter(r => r.source && r.source.has_synopsis).length;
  const withBoth = all.filter(r => r.source && r.source.has_intro && r.source.has_synopsis).length;

  console.log(`=== ENRICHISSEMENT SEMANTIQUE — ${all.length} FILMS ===\n`);
  console.log(`Films analyses : ${all.length}\n`);
  console.log(`Avec introduction          : ${withIntro}`);
  console.log(`Avec synopsis               : ${withSynopsis}`);
  console.log(`Avec introduction + synopsis: ${withBoth}\n`);
  console.log(`Profils generes : ${ok.length}`);
  console.log(`Echecs          : ${all.length - ok.length}\n`);

  const qCounts = { high: 0, medium: 0, low: 0 };
  ok.forEach(r => qCounts[r.data_quality]++);
  console.log(`Qualite des donnees :`);
  console.log(`  HIGH   : ${qCounts.high}`);
  console.log(`  MEDIUM : ${qCounts.medium}`);
  console.log(`  LOW    : ${qCounts.low}\n`);

  console.log(`Statistiques moyennes (sur ${ok.length} profils generes) :`);
  for (const field of SCORE_FIELDS) {
    console.log(`  ${field.padEnd(20)}: ${avg(ok.map(r => r.semantic_profile[field]))}`);
  }
  console.log(`  confidence          : ${avg(ok.map(r => r.confidence))}`);

  // Signal de qualite objectif : variance des scores (si tout se ressemble, les profils
  // ne discriminent pas grand-chose -> peu utile pour un moteur de recommandation)
  console.log(`\nDispersion des scores (ecart-type, plus haut = plus discriminant) :`);
  for (const field of SCORE_FIELDS) {
    const vals = ok.map(r => r.semantic_profile[field]);
    const m = avg(vals);
    const variance = vals.length ? vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length : 0;
    console.log(`  ${field.padEnd(20)}: ${Math.round(Math.sqrt(variance) * 10) / 10}`);
  }

  console.log(`\n=== 20 PROFILS REPRESENTATIFS ===`);
  // Echantillon volontairement varie : pris a intervalles reguliers dans la liste triee par pace (evite 20 films tous similaires)
  const sorted = [...ok].sort((a, b) => a.semantic_profile.pace - b.semantic_profile.pace);
  const step = Math.max(1, Math.floor(sorted.length / 20));
  const sample = sorted.filter((_, i) => i % step === 0).slice(0, 20);

  sample.forEach(r => {
    const p = r.semantic_profile;
    console.log(`\nFILM : ${r.title}`);
    console.log(`Genres : ${(r.facts.genres || []).join(", ") || "—"}`);
    console.log(`Moods : ${p.moods.join(", ") || "—"}`);
    console.log(`Themes : ${p.themes.join(", ") || "—"}`);
    console.log(`Tags : ${p.tags.join(", ") || "—"}`);
    console.log(`Humour: ${p.humor}/10  Intensite: ${p.intensity}/10  Violence: ${p.violence}/10  Complexite: ${p.complexity}/10`);
    console.log(`Feel-good: ${p.feel_good}/10  Romance: ${p.romance}/10  Darkness: ${p.darkness}/10  Action: ${p.action}/10`);
    console.log(`Suspense: ${p.suspense}/10  Emotion: ${p.emotional_intensity}/10  Pace: ${p.pace}/10`);
    console.log(`Confidence : ${r.confidence}  Data quality : ${r.data_quality.toUpperCase()}`);
  });

  // --- Recherches simulees ---
  const searchable = ok.map(r => ({
    title: r.title, genres: r.facts.genres, year: r.facts.year, runtime_minutes: r.facts.runtime_minutes,
    countries: r.facts.countries, actors: r.facts.actors, semantic_profile: r.semantic_profile,
  }));

  console.log(`\n\n=== 10 RECHERCHES SIMULEES (sur ${searchable.length} profils) ===`);
  QUERIES.forEach((q, i) => {
    const { top } = runQuery(q, searchable, 3);
    console.log(`\n${i + 1}. "${q}"`);
    if (top.length === 0) { console.log(`   Aucun resultat (contrainte dure non satisfaite par les ${searchable.length} films disponibles).`); return; }
    top.forEach((t, rank) => {
      console.log(`   #${rank + 1} ${t.film.title} — score ${Math.round(t.result.score)} — ${t.result.reasons.join(", ") || "correspondance generale"}`);
    });
  });

  console.log(`\n\n=== FIN DU RAPPORT ===`);
  console.log(`(Signaux quantitatifs ci-dessus a interpreter — la conclusion qualitative est a faire a la lecture des exemples et des recherches.)`);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = { run };
