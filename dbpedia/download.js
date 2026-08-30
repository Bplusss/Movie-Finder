#!/usr/bin/env node
// dbpedia/download.js
// npm run dbpedia:download
//
// Telecharge dans dbpedia/downloads/ uniquement les fichiers configures dans
// dbpedia/config.json (copie de config.example.json remplie avec les vraies
// URLs trouvees sur Databus). Ne telecharge jamais l'integralite de DBpedia.
"use strict";
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");
const DOWNLOADS_DIR = path.join(__dirname, "downloads");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`dbpedia/config.json introuvable. Copie dbpedia/config.example.json vers dbpedia/config.json et remplis les URLs trouvees sur Databus.`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    console.log(`  deja present, on ne re-telecharge pas : ${path.basename(destPath)}`);
    return;
  }
  console.log(`  telechargement : ${url}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} pour ${url}`);
  const total = parseInt(resp.headers.get("content-length") || "0", 10);
  let received = 0;
  const fileStream = fs.createWriteStream(destPath + ".part");

  await new Promise((resolve, reject) => {
    resp.body.on("data", chunk => {
      received += chunk.length;
      if (total) process.stdout.write(`\r  ${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} Mo`);
    });
    resp.body.pipe(fileStream);
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
    resp.body.on("error", reject);
  });
  process.stdout.write("\n");
  fs.renameSync(destPath + ".part", destPath);
  console.log(`  ok enregistre : ${path.basename(destPath)}`);
}

async function run() {
  const config = loadConfig();
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const targets = [
    ["labels_en", "labels_en.ttl.bz2"],
    ["abstracts_en", "abstracts_en.ttl.bz2"],
    ["long_abstracts_en", "long_abstracts_en.ttl.bz2"],
    ["wikidata_links_en", "wikidata_links_en.ttl.bz2"],
  ];

  for (const [key, filename] of targets) {
    const url = config[key];
    if (!url) { console.log(`- ${key} : non configure, ignore (champ correspondant restera vide dans le rapport)`); continue; }
    console.log(`- ${key} :`);
    try {
      await downloadFile(url, path.join(DOWNLOADS_DIR, filename));
    } catch (e) {
      console.error(`  echec du telechargement de ${key} : ${e.message}`);
    }
  }

  console.log("\nTermine. Lance maintenant : npm run dbpedia:test-match");
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e); process.exit(1); });
}
module.exports = { run };
