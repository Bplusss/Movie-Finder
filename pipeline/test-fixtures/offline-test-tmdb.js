// pipeline/test-fixtures/offline-test-tmdb.js
"use strict";
const assert = require("assert");
const { mapTmdbGenre, mapTmdbMovieToRow, isUsable, parseExportLine } = require("../lib/tmdb");

// --- Fixture : réponse TMDB réaliste pour un film, en français (append_to_response=credits,external_ids) ---
const fixtureDetails = {
  id: 194,
  title: "Amélie",
  original_title: "Le Fabuleux Destin d'Amélie Poulain",
  overview: "Une jeune serveuse parisienne rêveuse décide de changer la vie de ceux qui l'entourent.",
  release_date: "2001-04-25",
  runtime: 122,
  popularity: 45.2,
  genres: [{ id: 35, name: "Comédie" }, { id: 10749, name: "Romance" }],
  production_countries: [{ iso_3166_1: "FR", name: "France" }],
  spoken_languages: [{ iso_639_1: "fr" }],
  credits: {
    cast: [{ name: "Audrey Tautou" }, { name: "Mathieu Kassovitz" }],
    crew: [{ name: "Jean-Pierre Jeunet", job: "Director" }, { name: "Someone Else", job: "Producer" }],
  },
  external_ids: { imdb_id: "tt0211915", wikidata_id: "Q186531" },
};

const row = mapTmdbMovieToRow(fixtureDetails);
assert.strictEqual(row.tmdb_id, 194);
assert.strictEqual(row.wikidata_id, "Q186531");
assert.strictEqual(row.title, "Amélie");
assert.deepStrictEqual(row.genres, ["comedy", "romance"]);
assert.deepStrictEqual(row.directors, ["Jean-Pierre Jeunet"]);
assert.deepStrictEqual(row.actors, ["Audrey Tautou", "Mathieu Kassovitz"]);
assert.strictEqual(row.external_ids.imdb_id, "tt0211915");
assert.strictEqual(row.year, 2001);
assert.strictEqual(row.runtime_minutes, 122);
assert.deepStrictEqual(row.countries, ["France"]);
console.log("OK  mapTmdbMovieToRow (genres, réalisateur, casting, ids externes)");

assert.strictEqual(isUsable(row), true);
console.log("OK  isUsable accepte un film complet");

const incomplete = mapTmdbMovieToRow({ id: 2, title: "Film Vide", genres: [] });
assert.strictEqual(isUsable(incomplete), false);
console.log("OK  isUsable rejette un film sans genre ni année/durée (jamais deviné)");

// --- Parsing du fichier d'export quotidien (JSON Lines) ---
const line1 = JSON.stringify({ id: 862, original_title: "Toy Story", popularity: 41.5, adult: false });
const line2 = JSON.stringify({ id: 999, original_title: "Film Adulte", popularity: 10, adult: true });
assert.deepStrictEqual(parseExportLine(line1), { id: 862, popularity: 41.5 });
assert.strictEqual(parseExportLine(line2), null, "les films 'adult' doivent être exclus");
assert.strictEqual(parseExportLine("{ligne corrompue"), null, "une ligne corrompue ne doit pas planter le parsing");
console.log("OK  parseExportLine (filtre adult, tolère les lignes corrompues)");

console.log("\n=== TOUS LES TESTS OFFLINE TMDB PASSENT ===");
