// pipeline/test-fixtures/offline-test-semantic-profile.js
"use strict";
const assert = require("assert");
const { buildPrompt, parseAndValidate, SCORE_FIELDS } = require("../lib/semantic-profile");

// --- buildPrompt : inclut bien les faits et le texte, jamais rien invente si absent ---
const film1 = {
  title: "Don't Look Up", year: 2021, runtime_minutes: 138, countries: ["USA"],
  genres: ["comedy", "scifi", "drama"], directors: ["Adam McKay"],
  actors: ["Leonardo DiCaprio", "Jennifer Lawrence"],
  intro_text: "Don't Look Up is a 2021 American political satire.",
  synopsis_text: "Two astronomers try to warn humanity of an approaching comet.",
};
const prompt1 = buildPrompt(film1);
assert(prompt1.includes("Don't Look Up"));
assert(prompt1.includes("2021"));
assert(prompt1.includes("political satire"));
assert(prompt1.includes("approaching comet"));
console.log("OK  buildPrompt inclut les faits et le texte disponible");

const film2 = { title: "Film Obscur", year: null, runtime_minutes: null, countries: [], genres: [], directors: [], actors: [] };
const prompt2 = buildPrompt(film2);
assert(prompt2.includes("confidence basse"), "doit signaler l'absence de texte, jamais rien inventer a la place");
console.log("OK  buildPrompt signale explicitement l'absence de texte (jamais d'invention)");

// --- parseAndValidate : reponse complete et valide ---
const validResponse = JSON.stringify({
  moods: ["sombre", "reflexif"], themes: ["catastrophe", "politique"], tags: ["satire", "comete"],
  humor: 6, intensity: 7, violence: 2, complexity: 6, feel_good: 3, romance: 2,
  darkness: 7, action: 3, suspense: 6, emotional_intensity: 6, pace: 6,
  confidence: 0.85, data_quality: "high",
});
const r1 = parseAndValidate(validResponse);
assert.strictEqual(r1.valid, true);
assert.strictEqual(r1.profile.humor, 6);
assert.deepStrictEqual(r1.profile.moods, ["sombre", "reflexif"]);
console.log("OK  parseAndValidate accepte une reponse complete et valide");

// --- Champ manquant -> rejet explicite, jamais invente ---
const missingField = JSON.parse(validResponse);
delete missingField.violence;
const r2 = parseAndValidate(JSON.stringify(missingField));
assert.strictEqual(r2.valid, false);
assert(r2.error.includes("violence"), "l'erreur doit nommer precisement le champ manquant");
console.log("OK  champ score manquant -> rejet explicite (jamais invente a 0 ou une valeur par defaut)");

// --- Score hors bornes -> rejet ---
const outOfRange = JSON.parse(validResponse);
outOfRange.humor = 15;
const r3 = parseAndValidate(JSON.stringify(outOfRange));
assert.strictEqual(r3.valid, false);
assert(r3.error.includes("humor"));
console.log("OK  score hors bornes (0-10) -> rejet");

// --- confidence hors bornes -> rejet ---
const badConfidence = JSON.parse(validResponse);
badConfidence.confidence = 1.5;
const r4 = parseAndValidate(JSON.stringify(badConfidence));
assert.strictEqual(r4.valid, false);
console.log("OK  confidence hors bornes (0-1) -> rejet");

// --- data_quality invalide -> rejet ---
const badQuality = JSON.parse(validResponse);
badQuality.data_quality = "excellent";
const r5 = parseAndValidate(JSON.stringify(badQuality));
assert.strictEqual(r5.valid, false);
console.log("OK  data_quality hors enum (high/medium/low) -> rejet");

// --- JSON invalide -> rejet propre, jamais une exception qui plante tout ---
const r6 = parseAndValidate("ceci n'est pas du JSON");
assert.strictEqual(r6.valid, false);
console.log("OK  JSON invalide -> rejet propre sans exception");

// --- Balises markdown autour du JSON -> nettoyees correctement ---
const withFences = "```json\n" + validResponse + "\n```";
const r7 = parseAndValidate(withFences);
assert.strictEqual(r7.valid, true);
console.log("OK  balises markdown (```json ... ```) correctement retirees");

assert.strictEqual(SCORE_FIELDS.length, 11, "les 11 scores attendus doivent tous etre verifies");
console.log("OK  les 11 champs de score sont bien tous controles");

console.log("\n=== TOUS LES TESTS OFFLINE SEMANTIC-PROFILE PASSENT ===");
