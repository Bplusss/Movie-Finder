// pipeline/test-fixtures/offline-test-import-catalog.js
"use strict";
const assert = require("assert");
const { importCatalog, isValid } = require("../import-catalog-to-supabase");

class MockPool {
  constructor() { this.rows = new Map(); }
  async query(sql, params) {
    if (sql.includes("select count(*)")) return { rows: [{ n: this.rows.size }] };
    const wikidataId = params[0];
    const wasPresent = this.rows.has(wikidataId);
    this.rows.set(wikidataId, params);
    return { rows: [{ inserted: !wasPresent }] };
  }
}

const movies = [
  { wikidata_id: "Q1", movie_id: "m1", title: "Film Un", facts: { year: 2000, runtime_minutes: 100, countries: ["France"], genres: ["drama"], directors: ["X"], actors: ["Y"] }, source: {}, introText: "intro", synopsisOnlyText: "synopsis", semantic_profile: {}, semantic_status: "success", semantic_warnings: [], adult_content: { flagged: false } },
  { wikidata_id: "Q2", movie_id: "m2", title: "Film Deux", facts: {}, source: {}, semantic_profile: {}, semantic_status: "success", semantic_warnings: [], adult_content: {} },
  { wikidata_id: "", movie_id: "m3", title: "Sans ID Wikidata", facts: {} },
  { wikidata_id: "Q4", movie_id: "m4", title: "  " },
];

(async () => {
  assert.deepStrictEqual(isValid(movies[0]), []);
  assert(isValid(movies[2]).length > 0, "wikidata_id manquant doit etre invalide");
  assert(isValid(movies[3]).length > 0, "title vide doit etre invalide");
  console.log("OK  validation correcte : wikidata_id et title requis");

  const pool = new MockPool();
  const r1 = await importCatalog(pool, movies);
  assert.strictEqual(r1.read, 4);
  assert.strictEqual(r1.valid, 2, "seuls Q1 et Q2 sont valides");
  assert.strictEqual(r1.invalid, 2);
  assert.strictEqual(r1.inserted, 2, "premier passage : tout est un insert");
  assert.strictEqual(r1.updated, 0);
  assert.strictEqual(pool.rows.size, 2);
  console.log("OK  premier import : 2 films valides inseres, 2 invalides correctement rejetes");

  const r2 = await importCatalog(pool, movies);
  assert.strictEqual(r2.inserted, 0, "deuxieme passage : aucun nouvel insert");
  assert.strictEqual(r2.updated, 2, "deuxieme passage : les 2 doivent devenir des mises a jour");
  assert.strictEqual(pool.rows.size, 2, "le nombre total de lignes ne doit JAMAIS depasser 2");
  console.log("OK  IDEMPOTENCE PROUVEE : relancer l'import transforme les inserts en updates, jamais de doublon");

  assert.strictEqual([...pool.rows.keys()].sort().join(","), "Q1,Q2", "les cles doivent rester EXACTEMENT les wikidata_id d'origine");
  console.log("OK  aucun nouvel ID arbitraire genere -- wikidata_id preserve tel quel");

  console.log("\n=== TOUS LES TESTS OFFLINE IMPORT-CATALOG PASSENT ===");
})();
