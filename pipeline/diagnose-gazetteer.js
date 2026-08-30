#!/usr/bin/env node
// pipeline/diagnose-gazetteer.js
// node pipeline/diagnose-gazetteer.js "Christopher Nolan"
//
// Outil de DIAGNOSTIC uniquement — n'applique aucune correction. Verifie si
// un nom precis existe dans le gazetteer reel, et si non, cherche des
// correspondances partielles pour comprendre la cause exacte (absent du
// catalogue, orthographe differente, ou stocke ailleurs).
"use strict";
const path = require("path");
const { loadCatalog } = require("./lib/local-catalog");
const { buildGazetteer, normalizeName } = require("./lib/entity-gazetteer");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");

function run() {
  const nameToCheck = process.argv[2] || "Christopher Nolan";
  const catalogPath = process.argv[3] || FINAL_CATALOG_PATH;
  const { movies } = loadCatalog(catalogPath);
  const gazetteer = buildGazetteer(movies);

  const normalized = normalizeName(nameToCheck);
  console.log(`Recherche de "${nameToCheck}" (normalise : "${normalized}")\n`);

  const exactActor = gazetteer.actorNames.has(normalized);
  const exactDirector = gazetteer.directorNames.has(normalized);
  console.log(`Present tel quel dans les acteurs   : ${exactActor}`);
  console.log(`Present tel quel dans les realisateurs : ${exactDirector}\n`);

  if (!exactActor && !exactDirector) {
    const lastWord = normalized.split(" ").pop();
    console.log(`Aucune correspondance exacte. Recherche de variantes contenant "${lastWord}" :\n`);

    const directorMatches = [...gazetteer.directorNames.entries()].filter(([norm]) => norm.includes(lastWord));
    const actorMatches = [...gazetteer.actorNames.entries()].filter(([norm]) => norm.includes(lastWord));

    console.log(`Realisateurs contenant "${lastWord}" (${directorMatches.length}) :`);
    directorMatches.forEach(([, display]) => console.log(`  - "${display}"`));

    console.log(`\nActeurs contenant "${lastWord}" (${actorMatches.length}) :`);
    actorMatches.forEach(([, display]) => console.log(`  - "${display}"`));

    if (directorMatches.length === 0 && actorMatches.length === 0) {
      console.log(`\nAucune trace de "${lastWord}" nulle part -> probablement absent de ce sous-catalogue de 1018 films (pas un bug de normalisation).`);
    }

    const titleHint = process.argv[4];
    if (titleHint) {
      const film = movies.find(m => m.title.toLowerCase().includes(titleHint.toLowerCase()));
      if (film) {
        console.log(`\nFilm "${film.title}" trouve dans le catalogue. Son champ directors reel : ${JSON.stringify(film.facts.directors)}`);
      } else {
        console.log(`\nAucun film contenant "${titleHint}" dans ce catalogue.`);
      }
    }
  }

  console.log(`\nTaille totale du gazetteer : ${gazetteer.actorNames.size} acteurs, ${gazetteer.directorNames.size} realisateurs.`);
}

if (require.main === module) run();
module.exports = { run };