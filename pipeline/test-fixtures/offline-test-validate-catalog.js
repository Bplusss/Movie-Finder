// pipeline/test-fixtures/offline-test-validate-catalog.js
"use strict";
const assert = require("assert");
const { compareOne, deepEqualToleringKeyOrder } = require("../validate-supabase-catalog");

const jsonMovie = {
  wikidata_id: "Q1", movie_id: "m1", title: "Noé", facts: { year: 2014, runtime_minutes: 138, countries: ["France", "USA"], genres: ["drama"], directors: ["Darren Aronofsky"], actors: ["Russell Crowe"] },
  source: { wikipedia_language: "fr", wikipedia_title: "Noé (film)" },
  introText: "Une intro.", synopsisOnlyText: "Un synopsis.",
  semantic_profile: { humor: null, action: 5 }, semantic_status: "success", semantic_warnings: [],
  adult_content: { flagged: false, matched_terms: [] },
};

const dbRowIdentical = {
  movie_id: "m1", title: "Noé", year: 2014, runtime_minutes: 138, countries: ["France", "USA"], genres: ["drama"], directors: ["Darren Aronofsky"], actors: ["Russell Crowe"],
  wikipedia_language: "fr", wikipedia_title: "Noé (film)", intro_text: "Une intro.", synopsis_text: "Un synopsis.",
  semantic_profile: { action: 5, humor: null }, // ordre des cles DIFFERENT -- doit etre tolere
  semantic_status: "success", semantic_warnings: [],
  adult_content: { matched_terms: [], flagged: false }, // ordre different aussi, tolere
};

{
  const diffs = compareOne(jsonMovie, dbRowIdentical);
  assert.deepStrictEqual(diffs, [], "des donnees identiques (ordre de cles pres) ne doivent produire AUCUNE divergence");
  console.log("OK  cas identique : 0 divergence detectee, tolerance correcte sur l'ordre des cles d'objet");
}

{
  const dbRowWrongOrder = { ...dbRowIdentical, actors: ["Russell Crowe", "Autre Acteur"].reverse() };
  // volontairement un tableau dans un ORDRE different -> NE DOIT PAS etre tolere (contrairement aux objets)
  const dbRowTruncated = { ...dbRowIdentical, actors: [] }; // tableau tronque
  const diffsTruncated = compareOne(jsonMovie, dbRowTruncated);
  assert(diffsTruncated.some(d => d.field === "actors"), "un tableau tronque DOIT etre detecte, jamais tolere");
  console.log("OK  tableau tronque (acteurs perdus) correctement detecte comme divergence");
}

{
  const dbRowWrongTitle = { ...dbRowIdentical, title: "Titre Modifie Par Erreur" };
  const diffs = compareOne(jsonMovie, dbRowWrongTitle);
  assert.strictEqual(diffs.length, 1);
  assert.strictEqual(diffs[0].field, "title");
  assert.strictEqual(diffs[0].json, "Noé");
  assert.strictEqual(diffs[0].supabase, "Titre Modifie Par Erreur");
  console.log("OK  une chaine modifiee est detectee precisement, avec les deux valeurs affichees");
}

{
  const dbRowNullAppeared = { ...dbRowIdentical, year: null };
  const diffs = compareOne(jsonMovie, dbRowNullAppeared);
  assert(diffs.some(d => d.field === "year" && d.supabase === null), "un null apparu sans raison doit etre signale, jamais tolere silencieusement");
  console.log("OK  un null apparu sans raison (annee perdue) est detecte, jamais toléré silencieusement");
}

console.log("\n=== TOUS LES TESTS OFFLINE VALIDATE-CATALOG PASSENT ===");
