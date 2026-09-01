#!/usr/bin/env node
// pipeline/validate-supabase-catalog.js
// node pipeline/validate-supabase-catalog.js
//
// PHASE 3 de la migration. LECTURE SEULE des deux cotes (JSON + Supabase),
// ne modifie rien nulle part. Compare champ par champ chaque film. Tolerance
// UNIQUEMENT pour l'ordre des cles JSON dans les objets (semantic_profile,
// adult_content) -- aucune tolerance pour donnee perdue, ID modifie, tableau
// tronque, chaine modifiee, ou null apparu sans raison.
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { loadCatalog } = require("./lib/local-catalog");
const { buildTextFields } = require("./audit-catalog-for-migration");

const RESULTS_DIR = path.join(__dirname, "test-results");
const FINAL_CATALOG_PATH = path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");

function deepEqualToleringKeyOrder(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqualToleringKeyOrder(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every(k => deepEqualToleringKeyOrder(a[k], b[k]));
  }
  return false;
}

const FIELDS_TO_COMPARE = [
  { label: "movie_id", json: m => m.movie_id || null, db: r => r.movie_id },
  { label: "title", json: m => m.title, db: r => r.title },
  { label: "year", json: m => (m.facts ? m.facts.year : null), db: r => r.year },
  { label: "runtime_minutes", json: m => (m.facts ? m.facts.runtime_minutes : null), db: r => r.runtime_minutes },
  { label: "countries", json: m => (m.facts ? m.facts.countries || [] : []), db: r => r.countries },
  { label: "genres", json: m => (m.facts ? m.facts.genres || [] : []), db: r => r.genres },
  { label: "directors", json: m => (m.facts ? m.facts.directors || [] : []), db: r => r.directors },
  { label: "actors", json: m => (m.facts ? m.facts.actors || [] : []), db: r => r.actors },
  { label: "wikipedia_language", json: m => (m.source ? m.source.wikipedia_language : null), db: r => r.wikipedia_language },
  { label: "wikipedia_title", json: m => (m.source ? m.source.wikipedia_title : null), db: r => r.wikipedia_title },
  { label: "intro_text", json: m => m.introText || null, db: r => r.intro_text },
  { label: "synopsis_text", json: m => m.synopsisOnlyText || null, db: r => r.synopsis_text },
  { label: "semantic_profile", json: m => m.semantic_profile || {}, db: r => r.semantic_profile },
  { label: "semantic_status", json: m => m.semantic_status || null, db: r => r.semantic_status },
  { label: "semantic_warnings", json: m => m.semantic_warnings || [], db: r => r.semantic_warnings },
  { label: "adult_content", json: m => m.adult_content || {}, db: r => r.adult_content },
];

function compareOne(jsonMovie, dbRow) {
  const diffs = [];
  for (const f of FIELDS_TO_COMPARE) {
    const jv = f.json(jsonMovie), dv = f.db(dbRow);
    if (!deepEqualToleringKeyOrder(jv, dv)) diffs.push({ field: f.label, json: jv, supabase: dv });
  }
  return diffs;
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL non definie.");
  const { movies } = loadCatalog(FINAL_CATALOG_PATH);
  const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
  const merged = buildTextFields(movies, wikipediaResults);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query("select * from movies_catalog");
    const dbByWikidataId = new Map(rows.map(r => [r.wikidata_id, r]));

    let identical = 0, withDiffs = 0, missingInSupabase = 0;
    const problems = [];

    for (const jsonMovie of merged) {
      const dbRow = dbByWikidataId.get(jsonMovie.wikidata_id);
      if (!dbRow) { missingInSupabase++; problems.push({ wikidata_id: jsonMovie.wikidata_id, title: jsonMovie.title, issue: "ABSENT DE SUPABASE" }); continue; }
      const diffs = compareOne(jsonMovie, dbRow);
      if (diffs.length === 0) identical++;
      else { withDiffs++; problems.push({ wikidata_id: jsonMovie.wikidata_id, title: jsonMovie.title, issue: "DIVERGENCE", diffs }); }
    }

    const jsonIds = new Set(merged.map(m => m.wikidata_id));
    const extraInSupabase = rows.filter(r => !jsonIds.has(r.wikidata_id));

    console.log(`=== VALIDATION CROISEE JSON <-> movies_catalog ===\n`);
    console.log(`Films JSON             : ${merged.length}`);
    console.log(`Lignes Supabase        : ${rows.length}`);
    console.log(`Identiques             : ${identical}`);
    console.log(`Avec divergence(s)     : ${withDiffs}`);
    console.log(`Absents de Supabase    : ${missingInSupabase}`);
    console.log(`En trop dans Supabase (jamais dans le JSON) : ${extraInSupabase.length}`);

    if (problems.length) {
      console.log(`\n=== DETAIL DES PROBLEMES (${problems.length}) ===`);
      problems.slice(0, 20).forEach(p => {
        console.log(`\n${p.title} (${p.wikidata_id}) — ${p.issue}`);
        if (p.diffs) p.diffs.forEach(d => console.log(`    ${d.field} : JSON=${JSON.stringify(d.json)} | Supabase=${JSON.stringify(d.supabase)}`));
      });
      if (problems.length > 20) console.log(`\n... et ${problems.length - 20} de plus.`);
    }

    const success = identical === merged.length && extraInSupabase.length === 0;
    console.log(`\n${"=".repeat(60)}`);
    console.log(success
      ? `SUCCES : ${merged.length} JSON = ${merged.length} Supabase = memes donnees exploitables.`
      : `ECHEC — des divergences existent. NE PAS basculer en production tant que ceci n'est pas resolu.`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(e => { console.error("Erreur fatale :", e.message); process.exit(1); });
}
module.exports = { run, compareOne, deepEqualToleringKeyOrder, FIELDS_TO_COMPARE };
