// pipeline/test-fixtures/offline-test-wikipedia-api.js
"use strict";
const assert = require("assert");
const { parseExtractResponse, selectIntroParagraphs } = require("../lib/wikipedia-api");

// --- Réponse réaliste : article trouvé, avec redirection appliquée ---
const foundJson = {
  batchcomplete: "",
  query: {
    pages: {
      "83495": {
        pageid: 83495, ns: 0, title: "The Matrix",
        extract: "The Matrix is a 1999 science fiction action film written and directed by the Wachowskis.\n\nSet in the 22nd century, the film depicts a dystopian future.",
      },
    },
  },
};
const r1 = parseExtractResponse(foundJson, "The Matrix (film)"); // titre d'entrée avec redirection
assert.strictEqual(r1.found, true);
assert.strictEqual(r1.wikipedia_url, "https://en.wikipedia.org/wiki/The_Matrix");
assert(r1.intro_text_full.includes("Wachowskis"));
console.log("OK  parseExtractResponse (article trouvé, titre final après redirection utilisé)");

// --- Réponse réaliste : article absent (pas une erreur réseau) ---
const missingJson = {
  query: { pages: { "-1": { ns: 0, title: "Film Totalement Inexistant Xyzabc", missing: "" } } },
};
const r2 = parseExtractResponse(missingJson, "Film Totalement Inexistant Xyzabc");
assert.strictEqual(r2.found, false);
assert.strictEqual(r2.wikipedia_url, null);
console.log("OK  parseExtractResponse (article absent -> found=false, jamais une exception)");

// --- selectIntroParagraphs : premier paragraphe suffisant ---
const long1 = "A".repeat(250);
const full1 = `${long1}\n\nDeuxième paragraphe.`;
assert.strictEqual(selectIntroParagraphs(full1, 200), long1);
console.log("OK  selectIntroParagraphs (premier paragraphe déjà assez long -> pas besoin du second)");

// --- selectIntroParagraphs : premier paragraphe trop court -> concatène le suivant ---
const short1 = "Court.";
const para2 = "B".repeat(250);
const full2 = `${short1}\n\n${para2}`;
const result2 = selectIntroParagraphs(full2, 200);
assert(result2.includes(short1) && result2.includes(para2));
console.log("OK  selectIntroParagraphs (premier paragraphe trop court -> concatène le suivant)");

// --- selectIntroParagraphs : texte vide/null -> jamais planter, jamais inventer ---
assert.strictEqual(selectIntroParagraphs(null), null);
assert.strictEqual(selectIntroParagraphs(""), null);
console.log("OK  selectIntroParagraphs gère proprement l'absence de texte");

console.log("\n=== TOUS LES TESTS OFFLINE WIKIPEDIA-API PASSENT ===");
