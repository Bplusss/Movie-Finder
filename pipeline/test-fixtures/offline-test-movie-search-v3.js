// pipeline/test-fixtures/offline-test-movie-search-v3.js
"use strict";
const assert = require("assert");
const { buildGazetteer } = require("../lib/entity-gazetteer");
const { searchV3, classifyFamily } = require("../lib/movie-search-v3");

const catalog = [
  { wikidata_id: "Q1", title: "Mystic River", facts: { year: 2003, runtime_minutes: 138, genres: ["thriller"], directors: ["Clint Eastwood"], actors: ["Sean Penn"] },
    synopsisOnlyText: "Un homme cherche a se venger apres un drame qui a bouleverse son enfance.", introText: "Mystic River est un film dramatique realise par Clint Eastwood." },
  { wikidata_id: "Q2", title: "Vrai Film de Vengeance (autre realisateur)", facts: { year: 2015, runtime_minutes: 110, genres: ["action"], directors: ["Un Autre"], actors: ["X"] },
    synopsisOnlyText: "Une histoire de vengeance parfaitement centrale et explicite, le meilleur match possible pour ce mot.", introText: "Un film d'action realise par un autre realisateur." },
  { wikidata_id: "Q3", title: "Comedie Sans Rapport", facts: { year: 2010, runtime_minutes: 90, genres: ["comedy"], directors: ["Clint Eastwood"], actors: ["Y"] },
    synopsisOnlyText: "Une comedie legere sur des amis qui partent en vacances.", introText: "Une comedie realisee par Clint Eastwood." },
];
const gazetteer = buildGazetteer(catalog);

function fakeCosine(a, b) { return a[0] === b[0] ? 1 : 0.1; }
const embCacheSynopsis = { Q1: [1], Q2: [1], Q3: [0] };
const embCacheIntro = { Q1: [1], Q2: [1], Q3: [0] };
function fakeLookup(field, id) { return (field === "intro" ? embCacheIntro : embCacheSynopsis)[id] || null; }
async function fakeEmbed() { return [1]; }

(async () => {
  const r1 = await searchV3(catalog, gazetteer, "un film realise par Clint Eastwood qui parle de vengeance", {
    embeddingLookup: fakeLookup, queryEmbedFn: fakeEmbed, cosineSimilarity: fakeCosine,
  });
  assert.strictEqual(r1.pool_size, 2, "seuls les 2 films de Clint Eastwood doivent former le pool");
  assert(!r1.ranked.some(r => r.movie.wikidata_id === "Q2"), "CRITIQUE : le film-piege (vengeance parfaite mais AUTRE realisateur) ne doit JAMAIS apparaitre");
  assert(r1.ranked.some(r => r.movie.wikidata_id === "Q1"), "Mystic River (vrai film Eastwood, vengeance dans son synopsis) doit etre classe");
  console.log("OK  TEST CRITIQUE 1 : 'Eastwood + vengeance' exclut le piege hors-filtre, meme avec un score semantique parfait");

  assert.strictEqual(r1.family, "subject_narrative", "'vengeance' doit etre classee sujet/narratif, pas ambiance");
  const familyPeur = classifyFamily("qui fait peur");
  assert.strictEqual(familyPeur, "ambiance", "'peur' DOIT etre reconnue comme ambiance (l'ancien moteur seul ne le detectait pas)");
  console.log("OK  TEST CRITIQUE 2 : classification de famille correcte pour 'vengeance' (narratif) et 'peur' (ambiance, corrige)");

  // ============ TEST CORRECTIF REEL : "qui fait rire" — bug rapporte par feedback utilisateur ============
  // Avant correction : ni AMBIANCE_LEXICON ni l'ancien moteur ne reconnaissaient "rire",
  // la requete tombait en subject_narrative -> aucun signal d'humour -> resultats d'horreur observes.
  const familyRire = classifyFamily("un film de moins de 100 minutes qui fait rire");
  assert.strictEqual(familyRire, "ambiance", "'qui fait rire' DOIT desormais etre reconnue comme ambiance (bug reel corrige)");
  console.log("OK  CORRECTIF REEL : 'qui fait rire' est maintenant classee ambiance (etait subject_narrative avant, cause du bug observe)");

  const r2 = await searchV3(catalog, gazetteer, "un film qui fait peur", {
    embeddingLookup: fakeLookup, queryEmbedFn: fakeEmbed, cosineSimilarity: fakeCosine,
  });
  assert.strictEqual(r2.pool_size, 3, "sans filtre dur, les 3 films doivent etre eligibles");
  assert.strictEqual(r2.family, "ambiance");
  const q2Detail = r2.ranked.find(r => r.movie.wikidata_id === "Q2" || r.movie.wikidata_id === "Q1").detail;
  assert.strictEqual(q2Detail.embeddingField, "intro", "la famille ambiance doit utiliser l'embedding sur intro, pas synopsis");
  console.log("OK  requete purement semantique (aucun filtre dur) -> tout le catalogue eligible, embedding sur 'intro' pour l'ambiance");

  const r3 = await searchV3(catalog, gazetteer, "un film realise par Clint Eastwood", {});
  assert.strictEqual(r3.pool_size, 2, "le filtre dur doit toujours s'appliquer, meme si un residuel textuel generique subsiste");
  assert(r3.ranked.every(r => r.movie.facts.directors.includes("Clint Eastwood")));
  console.log("OK  requete a dominante structuree : le pool reste correctement filtre meme avec un residuel textuel generique ('un film')");

  console.log("\n=== TOUS LES TESTS OFFLINE MOVIE-SEARCH-V3 PASSENT ===");
})();
