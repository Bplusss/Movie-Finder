// pipeline/test-fixtures/offline-test-wikipedia-sections.js
"use strict";
const assert = require("assert");
const { parseSections, findSynopsisSection, normalizeSectionTitle } = require("../lib/wikipedia-sections");

// --- Fixture : article anglais complet et realiste ---
const fullTextEn = `The Matrix is a 1999 science fiction action film written and directed by the Wachowskis.

It depicts a dystopian future.

== Plot ==
A computer programmer named Neo discovers that reality is a simulation.
He joins a group of rebels to fight the machines.

== Cast ==
- Keanu Reeves as Neo
- Laurence Fishburne as Morpheus

== Production ==
The film was shot in Sydney, Australia over several months.

== Reception ==
The film received critical acclaim and won four Academy Awards.
`;

const parsedEn = parseSections(fullTextEn);
assert(parsedEn.intro.includes("Wachowskis"));
assert.strictEqual(parsedEn.sections.length, 4);
assert.strictEqual(parsedEn.sections[0].title, "Plot");
console.log("OK  parseSections (introduction + 4 sections correctement decoupees)");

const synopsisEn = findSynopsisSection(parsedEn.sections, "en");
assert(synopsisEn && synopsisEn.title === "Plot");
assert(synopsisEn.content.includes("Neo discovers"));
console.log("OK  findSynopsisSection (trouve 'Plot', contenu correct)");

// --- Le point CRITIQUE de la demande : Production/Cast/Reception ne doivent JAMAIS être pris pour un synopsis ---
const noPlotText = `Un film sans section plot.

== Cast ==
Liste des acteurs.

== Production ==
Tourne a Paris.

== Reception ==
Bien accueilli par la critique.
`;
const parsedNoPlot = parseSections(noPlotText);
const synopsisNone = findSynopsisSection(parsedNoPlot.sections, "en");
assert.strictEqual(synopsisNone, null, "Cast/Production/Reception ne doivent JAMAIS être confondus avec un synopsis");
console.log("OK  Cast/Production/Reception correctement REJETÉS (liste blanche stricte respectée)");

// --- Fixture francaise avec accents ---
const fullTextFr = `Amélie est un film français de 2001.

== Synopsis ==
Une jeune serveuse parisienne change la vie de ceux qui l'entourent.

== Distribution ==
Audrey Tautou dans le rôle principal.
`;
const parsedFr = parseSections(fullTextFr);
const synopsisFr = findSynopsisSection(parsedFr.sections, "fr");
assert(synopsisFr && synopsisFr.content.includes("serveuse parisienne"));
console.log("OK  findSynopsisSection (français, avec accents)");

// --- normalizeSectionTitle : "Résumé" et "resume" doivent être équivalents ---
assert.strictEqual(normalizeSectionTitle("Résumé"), normalizeSectionTitle("resume"));
console.log("OK  normalizeSectionTitle (accents normalisés)");

// --- Sous-sections (===) doivent aussi être détectées ---
const withSubsection = `Intro.

=== Plot ===
Contenu du plot en sous-section.
`;
const parsedSub = parseSections(withSubsection);
assert.strictEqual(parsedSub.sections[0].title, "Plot");
console.log("OK  parseSections gère aussi les sous-titres (===)");

console.log("\n=== TOUS LES TESTS OFFLINE WIKIPEDIA-SECTIONS PASSENT ===");
