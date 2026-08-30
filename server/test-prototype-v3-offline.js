// server/test-prototype-v3-offline.js
"use strict";
const assert = require("assert");
const { shortSynopsis, toClientShape } = require("./prototype-v3-server");

const movieShort = { wikidata_id: "Q1", title: "Court", facts: { year: 2010, directors: ["X"], actors: ["Y"] }, synopsisOnlyText: "Une phrase courte." };
const movieLong = { wikidata_id: "Q2", title: "Long", facts: { year: 2015, directors: [], actors: [] }, synopsisOnlyText: "A".repeat(50) + ". " + "B".repeat(300) };
const movieNoText = { wikidata_id: "Q3", title: "Sans texte", facts: { year: null, directors: [], actors: [] }, synopsisOnlyText: "" };

assert.strictEqual(shortSynopsis(movieShort), "Une phrase courte.");
console.log("OK  un texte court n'est pas tronqué");

const longResult = shortSynopsis(movieLong);
assert(longResult.length < movieLong.synopsisOnlyText.length, "un texte long doit être tronqué");
console.log("OK  un texte long est tronqué proprement");

assert.strictEqual(shortSynopsis(movieNoText), "(résumé non disponible dans le catalogue)");
console.log("OK  l'absence de texte est signalée honnêtement, jamais un résumé inventé");

const shape = toClientShape(movieShort, 1);
assert.strictEqual(shape.rank, 1);
assert.strictEqual(shape.year, 2010);
assert(!("availability" in shape) && !("disponibilite" in shape) && !("disponibilites" in shape), "AUCUN champ de disponibilité simulée ne doit exister");
console.log("OK  toClientShape ne contient aucun champ de disponibilité simulée");

// --- Duree : transmise si presente, jamais inventee si absente ---
const movieWithRuntime = { wikidata_id: "Q4", title: "Avec Duree", facts: { year: 2020, runtime_minutes: 112, directors: [], actors: [] }, synopsisOnlyText: "texte" };
const movieNoRuntime = { wikidata_id: "Q5", title: "Sans Duree", facts: { year: 2020, runtime_minutes: null, directors: [], actors: [] }, synopsisOnlyText: "texte" };
assert.strictEqual(toClientShape(movieWithRuntime, 1).runtimeMinutes, 112);
assert.strictEqual(toClientShape(movieNoRuntime, 1).runtimeMinutes, null, "aucune duree dans les donnees -> null, jamais une valeur inventee");
console.log("OK  durée transmise si disponible, null (jamais inventée) si absente");

// --- Le bug rapporté : "meme requete redonne toujours les memes films" -> maintenant corrige par exclusion ---
const { handleSearch } = require("./prototype-v3-server");
const catalog = [
  { wikidata_id: "Q1", title: "Film A", facts: { year: 2000, directors: ["X"], actors: ["Russell Crowe"] }, synopsisOnlyText: "un synopsis", introText: "" },
  { wikidata_id: "Q2", title: "Film B", facts: { year: 2001, directors: ["X"], actors: ["Russell Crowe"] }, synopsisOnlyText: "un synopsis", introText: "" },
  { wikidata_id: "Q3", title: "Film C", facts: { year: 2002, directors: ["X"], actors: ["Russell Crowe"] }, synopsisOnlyText: "un synopsis", introText: "" },
];
const { buildGazetteer } = require("../pipeline/lib/entity-gazetteer");
const gazetteer = buildGazetteer(catalog);

(async () => {
  const r1 = await handleSearch(catalog, gazetteer, {}, { query: "un film avec Russell Crowe" });
  const idsRound1 = r1.body.results.map(r => r.movie.id);
  assert.deepStrictEqual(idsRound1.sort(), ["Q1", "Q2", "Q3"]);
  console.log("OK  premier appel : les 3 films de Russell Crowe sont bien retournés");

  const r2 = await handleSearch(catalog, gazetteer, {}, { query: "un film avec Russell Crowe", excludeIds: idsRound1 });
  assert.strictEqual(r2.body.results.length, 0, "avec les 3 deja exclus, plus rien de frais ne doit rester (comportement honnete, pas d'invention)");
  console.log("OK  second appel avec excludeIds -> plus aucun des films deja vus ne réapparaît (bug corrigé)");

  const r3 = await handleSearch(catalog, gazetteer, {}, { query: "un film avec Russell Crowe", excludeIds: [idsRound1[0]] });
  assert(!r3.body.results.some(r => r.movie.id === idsRound1[0]), "le film explicitement exclu ne doit jamais revenir");
  assert.strictEqual(r3.body.results.length, 2, "les 2 autres doivent bien rester disponibles");
  console.log("OK  exclusion partielle : seuls les films déjà vus disparaissent, les autres restent");

  console.log("\n=== TOUS LES TESTS OFFLINE PROTOTYPE-V3 PASSENT ===");
})();

// --- Notes partielles : chaque note doit pouvoir etre envoyee independamment de l'autre ---
{
  const express = require("express");
  const { createApp } = require("./prototype-v3-server");
  const app = createApp();
  const feedbackHandler = app._routes.post["/api/feedback"];

  function callFeedback(body) {
    let responseBody, responseStatus = 200;
    const fakeRes = { status: (s) => { responseStatus = s; return fakeRes; }, json: (b) => { responseBody = b; } };
    feedbackHandler({ body }, fakeRes);
    return { status: responseStatus, body: responseBody };
  }

  const rOnlyRel = callFeedback({ query: "q", filmId: "Q1", relevanceRating: 2, filmRating: null });
  assert.strictEqual(rOnlyRel.status, 200, "noter UNIQUEMENT la pertinence doit être accepté");

  const rOnlyFilm = callFeedback({ query: "q", filmId: "Q1", relevanceRating: null, filmRating: 5 });
  assert.strictEqual(rOnlyFilm.status, 200, "noter UNIQUEMENT le film doit être accepté");

  const rNeither = callFeedback({ query: "q", filmId: "Q1", relevanceRating: null, filmRating: null });
  assert.strictEqual(rNeither.status, 400, "aucune des deux notes fournie -> toujours refusé");

  console.log("OK  chaque note (pertinence / film) est bien acceptée indépendamment de l'autre");
}

// --- DISPLAY_COUNT = 3 (principe "quelques films, pas 50") ---
{
  const catalogBig = Array.from({ length: 10 }, (_, i) => ({
    wikidata_id: `Q${i}`, title: `Film ${i}`, facts: { year: 2000, directors: ["X"], actors: ["Russell Crowe"] },
    synopsisOnlyText: "un synopsis", introText: "",
  }));
  const { buildGazetteer } = require("../pipeline/lib/entity-gazetteer");
  const gz = buildGazetteer(catalogBig);
  handleSearch(catalogBig, gz, {}, { query: "un film avec Russell Crowe" }).then(r => {
    assert.strictEqual(r.body.results.length, 3, "meme avec 10 films eligibles, seuls 3 doivent etre affiches par defaut");
    assert.strictEqual(r.body.hasMore, true, "hasMore doit signaler qu'il en reste d'autres");
    console.log("OK  affichage limite a 3 resultats par defaut, meme si plus de films sont eligibles");
  });
}

// --- irrelevanceReason : optionnel, jamais obligatoire, bien enregistre quand fourni ---
{
  const { createApp } = require("./prototype-v3-server");
  const app = createApp();
  const feedbackHandler = app._routes.post["/api/feedback"];
  function callFeedback(body) {
    let responseBody, responseStatus = 200;
    const fakeRes = { status: (s) => { responseStatus = s; return fakeRes; }, json: (b) => { responseBody = b; } };
    feedbackHandler({ body }, fakeRes);
    return { status: responseStatus, body: responseBody };
  }
  const rWithReason = callFeedback({ query: "q", filmId: "Q1", relevanceRating: 1, irrelevanceReasons: ["Mauvais sujet"] });
  assert.strictEqual(rWithReason.status, 200, "une raison de non-pertinence fournie doit être acceptée");
  const rWithoutReason = callFeedback({ query: "q", filmId: "Q1", relevanceRating: 1 });
  assert.strictEqual(rWithoutReason.status, 200, "l'absence de raison ne doit jamais bloquer l'enregistrement (optionnel)");
  const rMultiReasons = callFeedback({ query: "q", filmId: "Q1", relevanceRating: 1, irrelevanceReasons: ["Mauvais sujet", "Mauvais acteur/réalisateur"] });
  assert.strictEqual(rMultiReasons.status, 200, "plusieurs raisons simultanées doivent être acceptées (ex: mauvais sujet ET mauvais acteur)");
  const rInvalidReason = callFeedback({ query: "q", filmId: "Q1", relevanceRating: 1, irrelevanceReasons: "Mauvais sujet" });
  assert.strictEqual(rInvalidReason.status, 400, "irrelevanceReasons doit être un tableau, pas une chaîne seule");
  console.log("OK  plusieurs raisons de non-pertinence peuvent être sélectionnées simultanément");
}
