#!/usr/bin/env node
// pipeline/import-wikidata-v2.js
// npm run db:import
// Enchaîne les trois passes indépendantes : récupération, résolution des
// références, puis synopsis DBpedia. Chacune reste séparément relançable
// (npm run db:fetch / db:enrich:refs / db:enrich:dbpedia).
"use strict";
require("dotenv").config();

async function run() {
  console.log("=== Passe 1/3 : récupération des films ===\n");
  await require("./fetch-wikidata-films").run();
  console.log("\n=== Passe 2/3 : résolution des références ===\n");
  await require("./resolve-wikidata-refs").run();
  console.log("\n=== Passe 3/3 : synopsis (DBpedia) ===\n");
  await require("./enrich-dbpedia").run();
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
