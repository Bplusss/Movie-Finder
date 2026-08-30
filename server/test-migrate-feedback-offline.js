// server/test-migrate-feedback-offline.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { migrate } = require("./migrate-feedback-to-supabase");

class MockPoolWithUniqueConstraint {
  constructor() { this.rows = []; }
  async query(sql, params) {
    const [query, filmId, , , , , , , sessionId, createdAt] = params;
    const exists = this.rows.some(r => r.query === query && r.filmId === filmId && r.sessionId === sessionId && r.createdAt === createdAt);
    if (exists) return { rows: [] };
    this.rows.push({ query, filmId, sessionId, createdAt });
    return { rows: [{ id: this.rows.length }] };
  }
}

const testLogPath = path.join(__dirname, "test-migration-fixture.json");
fs.writeFileSync(testLogPath, JSON.stringify([
  { query: "un film avec Russell Crowe", filmId: "Q1", filmTitle: "Noé", position: 1, score: 88, relevanceRating: 5, filmRating: 4, sessionId: "s1", timestamp: "2026-08-20T10:00:00.000Z" },
  { query: "un film qui fait peur", filmId: "Q2", filmTitle: "Youth", position: 2, score: 70, relevanceRating: 2, filmRating: null, irrelevanceReasons: ["Mauvais sujet"], sessionId: "s2", timestamp: "2026-08-21T11:00:00.000Z" },
]));

(async () => {
  process.env.DATABASE_URL = "postgresql://fake-test-only";
  const pool = new MockPoolWithUniqueConstraint();

  const run1 = await migrate(testLogPath, pool);
  assert.strictEqual(run1.total, 2);
  assert.strictEqual(run1.inserted, 2, "premier passage : les 2 entrees doivent etre inserees");
  assert.strictEqual(run1.skipped, 0);
  console.log("OK  premier passage : 2 entrees inserees, timestamps/sessions originaux conserves");

  const run2 = await migrate(testLogPath, pool);
  assert.strictEqual(run2.inserted, 0, "deuxieme passage : AUCUNE nouvelle insertion");
  assert.strictEqual(run2.skipped, 2, "deuxieme passage : les 2 entrees doivent etre reconnues comme deja presentes");
  assert.strictEqual(pool.rows.length, 2, "le nombre total de lignes en base ne doit JAMAIS depasser 2, meme apres plusieurs migrations");
  console.log("OK  IDEMPOTENCE PROUVEE : relancer la migration ne cree jamais de doublon");

  fs.unlinkSync(testLogPath);
  console.log("\n=== TOUS LES TESTS OFFLINE MIGRATE-FEEDBACK PASSENT ===");
})();
