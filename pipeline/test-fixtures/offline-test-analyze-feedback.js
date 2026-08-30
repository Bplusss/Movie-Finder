// pipeline/test-fixtures/offline-test-analyze-feedback.js
"use strict";
const assert = require("assert");
const {
  computeVolume, computeRelevanceStats, countReasons, classifyQueryBucket,
  signalLevel, analyzeBuckets, detectChameleons, diagnoseActorDirectorComplaints,
} = require("../analyze-feedback");
const { buildGazetteer } = require("../lib/entity-gazetteer");

{
  assert.strictEqual(signalLevel(2, 1).level, "FAIBLE", "2 avis ne doit JAMAIS etre signale comme un signal fort");
  assert.strictEqual(signalLevel(4, 2).level, "FAIBLE");
  assert.strictEqual(signalLevel(7, 2).level, "MEDIUM");
  assert.strictEqual(signalLevel(12, 1).level, "HIGH");
  assert(signalLevel(12, 4).action.includes("renforcé"), "plusieurs reformulations independantes doit renforcer le signal");
  console.log("OK  seuils corrects : jamais de signal fort sur un petit echantillon, renforcement si reformulations multiples");
}

{
  const gz = buildGazetteer([]);
  assert.strictEqual(classifyQueryBucket("un film qui parle d'identité", gz), "psychologique_relationnelle");
  assert.strictEqual(classifyQueryBucket("un film sur la guerre du Vietnam", gz), "sujet_historique");
  assert.strictEqual(classifyQueryBucket("un film qui fait peur", gz), "ambiance");
  assert.strictEqual(classifyQueryBucket("un film sur un braquage", gz), "sujet_concret");
  console.log("OK  classification en familles correcte sur des cas representatifs reels");
}

{
  const log = [
    { query: "q1", filmId: "X1", filmTitle: "Film Synthetique Alpha", relevanceRating: 5 },
    { query: "q2", filmId: "X1", filmTitle: "Film Synthetique Alpha", relevanceRating: 1 },
    { query: "q3", filmId: "X1", filmTitle: "Film Synthetique Alpha", relevanceRating: 5 },
    { query: "q4", filmId: "X1", filmTitle: "Film Synthetique Alpha", relevanceRating: 1 },
    { query: "q5", filmId: "X1", filmTitle: "Film Synthetique Alpha", relevanceRating: 4 },
    { query: "q6", filmId: "X2", filmTitle: "Film Stable Beta", relevanceRating: 5 },
    { query: "q7", filmId: "X2", filmTitle: "Film Stable Beta", relevanceRating: 5 },
    { query: "q8", filmId: "X2", filmTitle: "Film Stable Beta", relevanceRating: 4 },
    { query: "q9", filmId: "X2", filmTitle: "Film Stable Beta", relevanceRating: 5 },
    { query: "q10", filmId: "X2", filmTitle: "Film Stable Beta", relevanceRating: 5 },
  ];
  const chameleons = detectChameleons(log);
  assert.strictEqual(chameleons.length, 1);
  assert.strictEqual(chameleons[0].filmTitle, "Film Synthetique Alpha", "doit detecter un film JAMAIS mentionne dans mon code (pas hardcode)");
  assert(!chameleons.some(c => c.filmTitle === "Film Stable Beta"), "un film stable ne doit jamais etre signale");
  console.log("OK  detection de films cameleons generique — fonctionne sur un titre entierement invente, jamais code en dur");
}

{
  const catalogWithDirector = [{ wikidata_id: "Q1", title: "Film Connu", facts: { directors: ["Vrai Realisateur"], actors: [] } }];
  const gz = buildGazetteer(catalogWithDirector);

  const logDataGap = [{ query: "un film réalisé par Realisateur Inconnu", filmId: "Q9", filmTitle: "X", irrelevanceReasons: ["Mauvais acteur/réalisateur"] }];
  const diagGap = diagnoseActorDirectorComplaints(logDataGap, gz);
  assert(diagGap[0].diagnosis.includes("TROU DE DONNEE"), "un nom absent du gazetteer doit etre diagnostique comme trou de donnee");

  const logEngineIssue = [{ query: "un film réalisé par Vrai Realisateur qui parle de vengeance", filmId: "Q9", filmTitle: "X", irrelevanceReasons: ["Mauvais acteur/réalisateur"] }];
  const diagEngine = diagnoseActorDirectorComplaints(logEngineIssue, gz);
  assert(diagEngine[0].diagnosis.includes("classement semantique"), "un nom reconnu dans le gazetteer doit pointer vers un probleme de classement, pas de donnee");
  console.log("OK  separation donnee/moteur correcte : nom absent -> trou de donnee ; nom present -> probleme de classement");
}

{
  const log = [
    { query: "a", filmId: "1", relevanceRating: 5, sessionId: "s1" },
    { query: "a", filmId: "2", relevanceRating: 1, sessionId: "s1" },
    { query: "b", filmId: "1", relevanceRating: null, filmRating: 3, sessionId: "s2" },
  ];
  const vol = computeVolume(log);
  assert.strictEqual(vol.totalFeedback, 3);
  assert.strictEqual(vol.distinctQueries, 2);
  assert.strictEqual(vol.distinctSessions, 2);
  assert.strictEqual(vol.queriesTestedMultipleTimes, 1, "'a' apparait 2 fois -> 1 requete testee plusieurs fois");

  const rel = computeRelevanceStats(log);
  assert.strictEqual(rel.count, 2, "seules les 2 entrees avec relevanceRating non-null comptent");

  const reasons = countReasons([{ irrelevanceReasons: ["Mauvais sujet", "Mauvais genre"] }, { irrelevanceReasons: ["Mauvais sujet"] }]);
  assert.strictEqual(reasons["Mauvais sujet"], 2);
  assert.strictEqual(reasons["Mauvais genre"], 1);
  console.log("OK  volume, pertinence et comptage des raisons corrects sur un cas de base");
}

console.log("\n=== TOUS LES TESTS OFFLINE ANALYZE-FEEDBACK PASSENT ===");
