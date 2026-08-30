// test-prototype-v3-helpers-offline.js
"use strict";
const assert = require("assert");
const { buildUnderstoodChips, explainWhyFriendly, GENRE_LABELS, IRRELEVANCE_REASONS } = require("./prototype-v3-helpers");

{
  const data = { filters: { actors: ["Russell Crowe"], directors: [], genres: [], year_min: null, year_max: null, runtime_min: null, runtime_max: null }, semantic_query: "" };
  const chips = buildUnderstoodChips(data);
  assert.deepStrictEqual(chips, ["👤 Russell Crowe"]);
  console.log("OK  acteur seul -> un seul chip, rien d'invente");
}

{
  const data = { filters: { actors: [], directors: [], genres: [], year_min: null, year_max: null, runtime_min: null, runtime_max: null }, semantic_query: "" };
  const chips = buildUnderstoodChips(data);
  assert.deepStrictEqual(chips, [], "aucun filtre extrait -> aucun chip affiche, jamais un faux critere invente");
  console.log("OK  aucune information extraite -> aucun chip affiché (jamais de faux critère)");
}

{
  const data = {
    filters: { actors: ["Russell Crowe"], directors: [], genres: ["thriller"], year_min: 2010, year_max: 2019, runtime_min: null, runtime_max: 120 },
    semantic_query: "vengeance",
  };
  const chips = buildUnderstoodChips(data);
  assert(chips.some(c => c.includes("Thriller")));
  assert(chips.some(c => c.includes("Russell Crowe")));
  assert(chips.some(c => c.includes("2010")));
  assert(chips.some(c => c.includes("2h")));
  assert(chips.some(c => c.includes("vengeance")));
  console.log("OK  combinaison complète : chaque information réellement extraite a son chip, formaté lisiblement");
}

{
  const dataAfter = { filters: { actors: [], directors: [], genres: [], year_min: 2015, year_max: null, runtime_min: null, runtime_max: null }, semantic_query: "" };
  assert(buildUnderstoodChips(dataAfter)[0].includes("après 2015"));
  const dataBefore = { filters: { actors: [], directors: [], genres: [], year_min: null, year_max: 2000, runtime_min: null, runtime_max: null }, semantic_query: "" };
  assert(buildUnderstoodChips(dataBefore)[0].includes("avant 2000"));
  console.log("OK  année ouverte (après X / avant Y) correctement formatée");
}

{
  const data = { filters: { actors: [], directors: [], genres: [], year_min: null, year_max: null, runtime_min: null, runtime_max: null }, semantic_query: "" };
  const result = { detail: {} };
  const text = explainWhyFriendly(result, data);
  assert(!text.match(/\d/), "aucun chiffre brut ne doit apparaître dans l'explication");
  assert.strictEqual(text, "Correspond aux critères de votre recherche.");
  console.log("OK  aucune information disponible -> phrase sobre générique, jamais un score inventé");
}

{
  const data = { filters: { actors: ["Russell Crowe"], directors: [], genres: [], year_min: null, year_max: null, runtime_min: null, runtime_max: null }, semantic_query: "vengeance" };
  const result = { detail: { lexical: 74, embedding: 0 } };
  const text = explainWhyFriendly(result, data);
  assert(text.includes("Russell Crowe"));
  assert(text.includes("vengeance"));
  assert(!text.match(/\b74\b/), "le score brut 74 ne doit jamais apparaître dans le texte lisible");
  console.log("OK  explication lisible mentionne l'acteur et le sujet, jamais le score numérique brut");
}

assert(IRRELEVANCE_REASONS.length === 5, "la liste doit contenir exactement les 5 raisons demandées");
assert.deepStrictEqual(IRRELEVANCE_REASONS, ["Mauvais sujet", "Mauvais genre", "Mauvaise époque", "Mauvais acteur/réalisateur", "Autre"]);
console.log("OK  liste des raisons de non-pertinence réduite aux 5 demandées");

console.log("\n=== TOUS LES TESTS OFFLINE PROTOTYPE-V3-HELPERS PASSENT ===");
