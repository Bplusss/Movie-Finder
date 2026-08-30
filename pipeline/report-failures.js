#!/usr/bin/env node
// pipeline/report-failures.js
// npm run report:failures
// Lecture SEULE du cache local — n'ecrit rien, ne modifie rien, ne touche pas Supabase.
"use strict";
const fs = require("fs");
const path = require("path");

const CACHE_PATH = path.join(__dirname, "test-results", "semantic-cache-1018.json");

function run() {
  if (!fs.existsSync(CACHE_PATH)) throw new Error(`${CACHE_PATH} introuvable.`);
  const cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
  const entries = Object.values(cache);
  const failed = entries.filter(e => e.status !== "success");
  const success = entries.filter(e => e.status === "success");

  console.log(`=== FILMS EN ECHEC (${failed.length}) ===\n`);
  const retriableTypes = ["invalid_json", "missing_fields", "wrong_schema", "network_error"];
  failed.forEach(e => {
    const retriable = retriableTypes.includes(e.status) && (e.attempts || 0) > 0;
    console.log(`Titre        : ${e.title}`);
    console.log(`Wikidata ID  : ${e.wikidata_id}`);
    console.log(`Raison       : [${e.status}] ${e.error || "(pas de message d'erreur)"}`);
    console.log(`Tentatives cumulees : ${e.attempts || 0}`);
    console.log(`Retraitable  : ${retriable ? "oui (categorie recuperable en theorie)" : "non / deja tente au maximum"}`);
    if (e.raw_response) {
      const preview = e.raw_response.length > 300 ? e.raw_response.slice(0, 300) + "..." : e.raw_response;
      console.log(`Derniere reponse Ollama (extrait) : ${preview}`);
    } else {
      console.log(`Derniere reponse Ollama : aucune disponible (probablement un echec reseau avant reception)`);
    }
    console.log("");
  });

  console.log(`=== RESUME ===`);
  console.log(`Succes   : ${success.length}`);
  console.log(`Echecs   : ${failed.length}`);
  console.log(`Total    : ${entries.length}`);
  const byType = {};
  failed.forEach(e => { byType[e.status] = (byType[e.status] || 0) + 1; });
  console.log(`Repartition des echecs :`, byType);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = { run };
