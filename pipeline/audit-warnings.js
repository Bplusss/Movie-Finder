#!/usr/bin/env node
// pipeline/audit-warnings.js
// npm run audit:warnings
"use strict";
const fs = require("fs");
const path = require("path");

const INPUT_PATH = path.join(__dirname, "test-results", "semantic-enrichment-1018-final.json");

const RULES = [
  { key: "family_friendly_vs_good_for", pattern: /family_friendly=.*good_for contient/, classification: "ACCEPTABLE — deja identifie comme du au manque de fiabilite connu de good_for (cf audit du 27/08), pas une vraie erreur de jugement semantique" },
  { key: "darkness_vs_feel_good", pattern: /darkness=.*feel_good=.*simultanement/, classification: "A VERIFIER — deux scores independants du modele en contradiction potentielle, mérite un vrai regard" },
  { key: "violence_vs_family_friendly", pattern: /violence=.*family_friendly=.*simultanement/, classification: "A VERIFIER — deux scores independants du modele en contradiction potentielle, mérite un vrai regard" },
  { key: "humor_vs_darkness", pattern: /humor=.*darkness=.*simultanement/, classification: "A VERIFIER — combinaison rare, mérite un vrai regard (peut aussi etre legitime : comedie noire)" },
];

function classify(warningText) {
  for (const rule of RULES) if (rule.pattern.test(warningText)) return rule;
  return { key: "inconnu", classification: "MOTIF NON RECONNU — necessite une inspection manuelle" };
}

function run() {
  const final = JSON.parse(fs.readFileSync(INPUT_PATH, "utf8"));
  const withWarnings = final.filter(f => f.semantic_warnings && f.semantic_warnings.length);

  const counts = {};
  const examples = {};
  let total = 0;

  withWarnings.forEach(f => {
    f.semantic_warnings.forEach(w => {
      const rule = classify(w);
      counts[rule.key] = (counts[rule.key] || 0) + 1;
      if (!examples[rule.key]) examples[rule.key] = [];
      if (examples[rule.key].length < 5) examples[rule.key].push(`${f.title} : ${w}`);
      total++;
    });
  });

  console.log(`=== AUDIT DES WARNINGS DE COHERENCE (${total} au total, sur ${withWarnings.length} films) ===\n`);
  for (const rule of RULES) {
    const n = counts[rule.key] || 0;
    console.log(`[${rule.key}] : ${n} occurrence(s)`);
    console.log(`  Classification : ${rule.classification}`);
    (examples[rule.key] || []).forEach(ex => console.log(`  - ${ex}`));
    console.log("");
  }
  if (counts["inconnu"]) {
    console.log(`[inconnu] : ${counts["inconnu"]} occurrence(s) non reconnues — a inspecter manuellement`);
  }

  const acceptable = counts["family_friendly_vs_good_for"] || 0;
  const toVerify = total - acceptable;
  console.log(`\n=== RESUME ===`);
  console.log(`Total warnings              : ${total}`);
  console.log(`Acceptables (good_for connu) : ${acceptable}`);
  console.log(`A verifier (contradiction potentiellement reelle) : ${toVerify}`);
}

if (require.main === module) {
  try { run(); } catch (e) { console.error("Erreur :", e.message); process.exit(1); }
}
module.exports = { run, classify };
