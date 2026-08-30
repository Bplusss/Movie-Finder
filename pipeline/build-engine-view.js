#!/usr/bin/env node
// pipeline/build-engine-view.js
// npm run build:engine-view
//
// Derive une vue "prete pour le moteur" a partir du dataset final : ne garde
// que les champs consideres fiables. "good_for" est DELIBEREMENT absent ici
// (experimental, cf. audit) — il reste dans le dataset complet mais ne doit
// pas servir au filtrage/matching.
"use strict";
const fs = require("fs");
const path = require("path");

const INPUT_PATH = path.join(__dirname, "test-results", "semantic-enrichment-1018-final.json");
const OUTPUT_PATH = path.join(__dirname, "test-results", "semantic-engine-view-1018.json");

function run() {
  const final = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));

  const view = final.map(f => {
    const p = f.semantic_profile;
    return {
      movie_id: f.movie_id, wikidata_id: f.wikidata_id, title: f.title,
      year: f.facts.year, runtime_minutes: f.facts.runtime_minutes,
      countries: f.facts.countries, genres: f.facts.genres,
      directors: f.facts.directors, actors: f.facts.actors,
      tone: p.tone, moods: p.moods,
      humor: p.humor, action: p.action, violence: p.violence, tension: p.tension,
      romance: p.romance, emotional: p.emotional, complexity: p.complexity,
      feel_good: p.feel_good, darkness: p.darkness, family_friendly: p.family_friendly,
      themes: p.themes, keywords: p.keywords,
      // "good_for" delibrement omis — experimental, non fiable pour le filtrage (cf. audit 27/08)
      exclude_adult_content: f.adult_content.flagged, // true par defaut cote moteur = a exclure sauf action explicite de l'utilisateur
      has_semantic_profile: f.semantic_status === "success",
    };
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(view, null, 2));
  console.log(`Vue moteur ecrite : ${OUTPUT_PATH} (${view.length} films)`);
  console.log(`Rappel : "good_for" est absent de cette vue par choix — experimental, ne pas l'utiliser pour le matching.`);
  console.log(`Films avec exclude_adult_content=true : ${view.filter(v => v.exclude_adult_content).length}`);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = { run };
