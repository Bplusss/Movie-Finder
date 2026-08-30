// pipeline/test-fixtures/offline-test-semantic-profile-v2.js
"use strict";
const assert = require("assert");
const { buildPrompt, parseAndValidate, countNulls, normalizeArrayFields, checkStructure, SCORE_FIELDS, ARRAY_FIELDS, ALL_FIELDS } = require("../lib/semantic-profile-v2");

// --- Reponse complete, sans null ---
const full = { tone: ["sombre"], moods: ["tendu"], humor: 1, action: 4, violence: 7, tension: 9,
  romance: 0, emotional: 5, complexity: 6, feel_good: 1, darkness: 8, family_friendly: 0,
  themes: ["vengeance"], keywords: ["tueur en serie"], good_for: ["soiree seul"] };
const r1 = parseAndValidate(JSON.stringify(full));
assert.strictEqual(r1.valid, true);
assert.strictEqual(r1.profile.violence, 7);
assert.strictEqual(countNulls(r1.profile), 0);
console.log("OK  parseAndValidate accepte une reponse complete sans null");

// --- null EXPLICITEMENT ACCEPTE (le point le plus important de cette version) ---
const withNulls = { ...full, romance: null, family_friendly: null };
const r2 = parseAndValidate(JSON.stringify(withNulls));
assert.strictEqual(r2.valid, true, "null doit etre une reponse VALIDE, pas une erreur");
assert.strictEqual(r2.profile.romance, null);
assert.strictEqual(r2.profile.family_friendly, null);
assert.strictEqual(countNulls(r2.profile), 2);
console.log("OK  null est accepte comme reponse legitime pour un score incertain (pas un rejet)");

// ============ LE POINT CRITIQUE SIGNALE : champ ABSENT != null ============

// --- Champ score absent du JSON -> INVALID (pas null, pas devine) ---
const missingKey = { ...full };
delete missingKey.tension;
const r3 = parseAndValidate(JSON.stringify(missingKey));
assert.strictEqual(r3.valid, false, "un champ absent doit être INVALID, jamais traité comme null");
assert.strictEqual(r3.errorType, "missing_fields");
assert(r3.error.includes("tension"));
console.log("OK  un champ score absent -> INVALID (missing_fields), plus jamais confondu avec null");

// --- Champ tableau absent du JSON -> INVALID aussi ---
const noThemes = { ...full }; delete noThemes.themes;
const r6 = parseAndValidate(JSON.stringify(noThemes));
assert.strictEqual(r6.valid, false);
assert.strictEqual(r6.errorType, "missing_fields");
assert(r6.error.includes("themes"));
console.log("OK  un champ tableau absent -> INVALID aussi (même règle que les scores)");

// --- CAS REEL RAPPORTE : "Aliens, le retour" — JSON hors schema, aucun champ attendu present ---
const aliensCase = {
  "scène": "Arrivée des secours", "date_estimée": "17 jours après l'atterrissage",
  "personnages": ["Ripley", "Hicks"], "description": "L'équipe de secours...",
};
const rAliens = parseAndValidate(JSON.stringify(aliensCase));
assert.strictEqual(rAliens.valid, false, "un JSON hors-schéma ne doit JAMAIS ressortir comme '15 null'");
assert.strictEqual(rAliens.errorType, "wrong_schema", "aucun de nos 15 champs présents -> wrong_schema, pas missing_fields");
console.log("OK  cas réel 'Aliens, le retour' (JSON hors schéma, 0 champ present) -> wrong_schema, plus de faux positif");

// --- CAS REEL RAPPORTE : objet vide {} ---
const rEmpty = parseAndValidate(JSON.stringify({}));
assert.strictEqual(rEmpty.valid, false);
assert.strictEqual(rEmpty.errorType, "wrong_schema", "objet vide = 0 champ present -> wrong_schema");
assert.strictEqual(rEmpty.error.split(", ").length, ALL_FIELDS.length, "les 15 champs doivent être listés comme manquants");
console.log("OK  cas réel '{}' (objet vide) -> INVALID, tous les champs listés comme manquants");

// --- Reponse qui n'est pas un objet du tout (ex: un tableau, ou une chaine) ---
const rArray = parseAndValidate(JSON.stringify(["pas", "un", "objet"]));
assert.strictEqual(rArray.valid, false);
assert.strictEqual(rArray.errorType, "invalid_structure");
console.log("OK  une réponse qui n'est pas un objet JSON (ex: un tableau) -> invalid_structure");

// ============ Le reste (deja valide precedemment) ============

// --- Type incorrect (ni nombre ni null) -> rejete ---
const badType = { ...full, humor: "beaucoup" };
const r4 = parseAndValidate(JSON.stringify(badType));
assert.strictEqual(r4.valid, false);
assert.strictEqual(r4.errorType, "invalid_types");
assert(r4.error.includes("humor"));
console.log("OK  un type incorrect (ex: chaine au lieu de nombre/null) est rejete");

// --- Hors bornes -> rejete meme si numerique ---
const outOfRange = { ...full, darkness: 15 };
const r5 = parseAndValidate(JSON.stringify(outOfRange));
assert.strictEqual(r5.valid, false);
assert.strictEqual(r5.errorType, "invalid_types");
console.log("OK  une valeur numerique hors bornes (0-10) est rejetee");

// --- Element unique renvoyé comme chaîne plutôt que tableau -> normalisé, pas rejeté (cas réel observé avec Qwen2.5) ---
const singleAsString = { ...full, tone: "sombre" };
const r6b = parseAndValidate(JSON.stringify(singleAsString));
assert.strictEqual(r6b.valid, true, "une chaîne unique au lieu d'un tableau à un élément ne doit pas être rejetée");
assert.deepStrictEqual(r6b.profile.tone, ["sombre"]);
assert.deepStrictEqual(r6b.corrections, ["tone"]);
console.log("OK  chaîne unique au lieu d'un tableau -> normalisée en tableau à un élément (rien inventé, juste reformaté)");

// --- JSON invalide (tronqué, comme le cas "Don't Look Up") -> invalid_json, jamais un profil partiel ---
const truncated = '{"tone": "serieux", "humor": 3, "action":';
const rTrunc = parseAndValidate(truncated);
assert.strictEqual(rTrunc.valid, false);
assert.strictEqual(rTrunc.errorType, "invalid_json");
assert.strictEqual(rTrunc.rawResponse, truncated, "la réponse brute (même tronquée) doit être conservée pour audit");
console.log("OK  JSON tronqué (cas 'Don't Look Up') -> invalid_json, réponse brute conservée");

// ============ TESTS DÉDIÉS À normalizeArrayFields (étape séparée) ============

const withNullArray = { tone: null, moods: ["leger"], themes: null, keywords: null, good_for: null };
const { normalized: n1, corrections: c1 } = normalizeArrayFields(withNullArray);
assert.strictEqual(n1.tone, null, "null doit rester null après normalisation, jamais []");
assert.strictEqual(n1.themes, null);
assert.deepStrictEqual(c1, [], "null n'est pas une correction — c'est une réponse volontaire, rien à corriger");
console.log("OK  normalizeArrayFields préserve null tel quel (jamais transformé en [])");

const withStrings = { tone: "sombre", moods: ["leger", "drole"], themes: "vengeance", keywords: [], good_for: null };
const { normalized: n2, corrections: c2 } = normalizeArrayFields(withStrings);
assert.deepStrictEqual(n2.tone, ["sombre"]);
assert.deepStrictEqual(n2.moods, ["leger", "drole"], "un tableau déjà correct ne doit pas être modifié");
assert.deepStrictEqual(n2.themes, ["vengeance"]);
assert.deepStrictEqual(n2.good_for, null, "null reste null même à côté d'autres champs corrigés");
assert.deepStrictEqual(c2.sort(), ["themes", "tone"].sort());
console.log("OK  normalizeArrayFields corrige uniquement les chaînes, trace précisément quels champs ont été corrigés");

// --- checkStructure isolement ---
assert.strictEqual(checkStructure(full).ok, true);
assert.strictEqual(checkStructure({}).ok, false);
assert.strictEqual(checkStructure(aliensCase).ok, false);
console.log("OK  checkStructure testé isolément sur les cas réels signalés");

// --- Frontiere precise wrong_schema (0 champ) vs missing_fields (au moins 1 champ present) ---
const almostComplete = { ...full }; delete almostComplete.good_for; // 14/15 presents
const rAlmost = parseAndValidate(JSON.stringify(almostComplete));
assert.strictEqual(rAlmost.errorType, "missing_fields", "14/15 champs presents -> missing_fields, pas wrong_schema");
const oneFieldOnly = { humor: 5 }; // seulement 1/15 present
const rOneField = parseAndValidate(JSON.stringify(oneFieldOnly));
assert.strictEqual(rOneField.errorType, "missing_fields", "au moins 1 champ present -> missing_fields, meme si presque tout manque");
console.log("OK  frontiere wrong_schema (0 champ) / missing_fields (>=1 champ) correctement tracee");

// --- Le profil final via parseAndValidate expose bien les corrections + la réponse brute ---
const rawWithString = JSON.stringify({ ...full, tone: "sombre", romance: null });
const r7 = parseAndValidate(rawWithString);
assert.strictEqual(r7.valid, true);
assert.deepStrictEqual(r7.corrections, ["tone"]);
assert.strictEqual(r7.rawResponse, rawWithString, "la réponse brute doit être conservée pour audit");
assert.strictEqual(r7.profile.romance, null);
console.log("OK  parseAndValidate expose les corrections effectuées et conserve la réponse brute (audit)");

// --- countNulls compte les null explicites sur scores ET tableaux ---
const profileWithArrayNull = { ...full, tone: null };
const parsedForCount = parseAndValidate(JSON.stringify(profileWithArrayNull));
assert.strictEqual(countNulls(parsedForCount.profile), 1, "countNulls doit aussi compter un tableau null");
console.log("OK  countNulls comptabilise les null explicites sur les scores ET sur les tableaux");

// --- buildPrompt : signale l'absence de texte sans jamais inventer ---
const filmNoText = { title: "Film Obscur" };
assert(buildPrompt(filmNoText).includes("null pour tout score"));
console.log("OK  buildPrompt encourage explicitement null quand le texte manque");

assert.strictEqual(SCORE_FIELDS.length, 10);
assert.strictEqual(ALL_FIELDS.length, 15);
console.log("OK  10 scores + 5 tableaux = 15 champs (conforme au schéma v2 demandé)");

console.log("\n=== TOUS LES TESTS OFFLINE SEMANTIC-PROFILE-V2 PASSENT ===");
