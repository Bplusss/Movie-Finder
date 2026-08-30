// pipeline/test-fixtures/offline-test-semantic-search-engine.js
// Couvre les 12 tests explicitement demandes suite a l'audit du 29/08.
"use strict";
const assert = require("assert");
const { parseQuery, scoreMovie, search } = require("../lib/semantic-search-engine");

function makeMovie(wid, title, facts, profile, adultOverrides = {}) {
  return { wikidata_id: wid, title, facts, semantic_profile: profile, adult_content: { flagged: false, matched_terms: [], ...adultOverrides } };
}

const emptyProfile = () => ({ humor: null, action: null, violence: null, tension: null, romance: null, emotional: null, complexity: null, feel_good: null, darkness: null, family_friendly: null, tone: [], moods: [], themes: [], keywords: [], good_for: [] });

// ============ TEST 1 : film adulte parfait -> jamais retourne ============
const perfectAdultFilm = makeMovie("Qadult", "Film Parfait Mais Adulte", { genres: ["comedy"] },
  { ...emptyProfile(), humor: 10, feel_good: 10, themes: ["pornographie"], keywords: ["porno"] });
{
  const { top } = search([perfectAdultFilm], "un film drôle", { n: 10 });
  assert.strictEqual(top.length, 0, "un film adulte confirme, meme avec un profil parfait, ne doit JAMAIS apparaitre");
  console.log("TEST 1 OK — film adulte parfait (score 100 potentiel) -> jamais retourne");
}

// ============ TEST 2 : romance=null -> aucune contribution ============
const filmNullRomance = makeMovie("Q2", "Film Romance Inconnue", { genres: [] }, { ...emptyProfile() });
{
  const parsed = parseQuery("un film romantique");
  const r = scoreMovie(filmNullRomance, parsed);
  assert.deepStrictEqual(r.contributions, []);
  console.log("TEST 2 OK — romance=null -> aucune contribution");
}

// ============ TEST 3 : romance=0 -> contribution reelle ============
const filmRomanceZero = makeMovie("Q3", "Film Sans Romance (explicite)", { genres: [] }, { ...emptyProfile(), romance: 0 });
{
  const parsed = parseQuery("un film romantique");
  const r = scoreMovie(filmRomanceZero, parsed);
  assert.strictEqual(r.contributions.length, 1);
  assert.strictEqual(r.contributions[0].points, 0);
  console.log("TEST 3 OK — romance=0 (explicite) -> contribution reelle, distincte de null");
}

// ============ TEST 4 : genre "action" demande -> film sans action genre exclu, jamais equivalent ============
const filmActionGenre = makeMovie("Q4a", "Vrai Film d'Action", { genres: ["action"] }, { ...emptyProfile(), violence: 8 });
const filmSansActionCase = makeMovie("Q4b", "Film Sans Genre Action (ex: Her)", { genres: ["drama", "romance"] }, { ...emptyProfile(), violence: 0 });
{
  const { top, excludedByGenre } = search([filmActionGenre, filmSansActionCase], "un film d'action mais pas trop violent", { n: 10 });
  assert.strictEqual(excludedByGenre, 1, "le film sans genre action doit etre compte comme exclu par contrainte de genre");
  assert.strictEqual(top.length, 1);
  assert.strictEqual(top[0].movie.wikidata_id, "Q4a", "un film sans genre action ne doit JAMAIS remonter, meme avec violence=0 (cas reel 'Her')");
  console.log("TEST 4 OK — genre 'action' est une contrainte dure : un film sans ce genre est exclu, jamais equivalent via un autre critere");
}

// ============ TEST 5 : violence<=4 -> film violence=8 exclu du TOP via score, mais pas de la liste (preference, pas contrainte dure) ============
const filmViolent = makeMovie("Q5a", "Tres Violent", { genres: ["action"] }, { ...emptyProfile(), violence: 8 });
const filmPeuViolent = makeMovie("Q5b", "Peu Violent", { genres: ["action"] }, { ...emptyProfile(), violence: 2 });
{
  const { top } = search([filmViolent, filmPeuViolent], "un film d'action mais pas trop violent", { n: 10 });
  assert.strictEqual(top[0].movie.wikidata_id, "Q5b", "le film peu violent doit etre classe devant le tres violent");
  assert(top[0].result.total > top[1].result.total);
  console.log("TEST 5 OK — violence=8 nettement moins bien classe que violence=2 sur 'pas trop violent'");
}

// ============ TEST 6 : mysterieux -> influence reellement le ranking (via moods/tone/themes/keywords) ============
const filmMysterieuxKeyword = makeMovie("Q6a", "Complexe Avec Mystere", { genres: [] }, { ...emptyProfile(), complexity: 9, keywords: ["enigme non resolue"] });
const filmComplexeSansSignal = makeMovie("Q6b", "Complexe Sans Signal Mystere", { genres: [] }, { ...emptyProfile(), complexity: 9 });
{
  const { top } = search([filmComplexeSansSignal, filmMysterieuxKeyword], "un film mystérieux et intelligent", { n: 10 });
  assert.strictEqual(top[0].movie.wikidata_id, "Q6a", "le film avec un vrai signal de mystere doit devancer un film egalement complexe mais sans ce signal");
  console.log("TEST 6 OK — 'mysterieux' favorise reellement les films avec un signal de mystere (moods/tone/themes/keywords)");
}

// ============ TEST 7 : romantique mais pas trop triste -> les deux composantes comptent ============
{
  const parsed = parseQuery("un film romantique mais pas trop triste");
  assert.strictEqual(parsed.min.romance, 6);
  assert(parsed.min.feel_good >= 5, "« pas trop triste » doit se traduire par un feel_good minimum (pas de champ tristesse dans le schema)");
  console.log("TEST 7 OK — romance ET feel_good sont bien tous les deux representes pour cette requete");
}

// ============ TEST 8 : null ne devient jamais une valeur inventee (verification globale) ============
{
  const parsed = parseQuery("un film sombre, violent et intense");
  const r = scoreMovie(makeMovie("Q8", "Tout Null", { genres: [] }, emptyProfile()), parsed);
  assert.deepStrictEqual(r.contributions, [], "tous les criteres etant null, aucune contribution ne doit etre inventee");
  console.log("TEST 8 OK — un film entierement null sur les criteres demandes -> aucune valeur inventee");
}

// ============ TEST 9 : chargement sans erreur ============
{
  const bigList = Array.from({ length: 50 }, (_, i) => makeMovie(`Qbig${i}`, `Film ${i}`, { genres: ["drama"] }, emptyProfile()));
  const { top } = search(bigList, "un film", { n: 10 });
  assert(Array.isArray(top));
  console.log("TEST 9 OK — une liste de films se charge et se recherche sans erreur");
}

// ============ TEST 10 : determinisme (meme requete + meme catalogue = meme classement) ============
{
  const catalog = [filmActionGenre, filmSansActionCase, filmViolent, filmPeuViolent, filmMysterieuxKeyword, filmComplexeSansSignal];
  const r1 = search(catalog, "un film d'action mais pas trop violent", { n: 10 });
  const r2 = search(catalog, "un film d'action mais pas trop violent", { n: 10 });
  assert.deepStrictEqual(r1.top.map(t => t.movie.wikidata_id), r2.top.map(t => t.movie.wikidata_id));
  console.log("TEST 10 OK — resultats deterministes (meme requete + meme catalogue = meme classement)");
}

// ============ TEST 11 : aucun film adulte confirme dans aucune des 10 requetes reelles ============
{
  const QUERIES = [
    "Je veux un film drôle pour ce soir", "Un thriller très tendu et sombre", "Un film d'action mais pas trop violent",
    "Quelque chose de chaleureux à regarder en famille", "Un film romantique mais pas trop triste",
    "Un film complexe qui fait réfléchir", "Un film avec beaucoup d'action et peu de romance",
    "Un film sombre, violent et intense", "Je veux quelque chose de léger et feel-good", "Un film mystérieux et intelligent",
  ];
  const catalog = [perfectAdultFilm, filmActionGenre, filmSansActionCase, filmViolent, filmPeuViolent];
  QUERIES.forEach(q => {
    const { top } = search(catalog, q, { n: 10 });
    assert(!top.some(t => t.movie.wikidata_id === "Qadult"), `le film adulte ne doit apparaitre pour aucune requete (echec sur: "${q}")`);
  });
  console.log("TEST 11 OK — aucun film adulte confirme n'apparait, quelle que soit la requete parmi les 10");
}

// ============ TEST 12 : contrainte obligatoire non reductible a une somme de criteres ============
{
  const filmSansGenreMaisExcellent = makeMovie("Q12", "Excellent Mais Pas Action", { genres: ["drama"] }, { ...emptyProfile(), violence: 0, humor: 10 });
  const { top } = search([filmSansGenreMaisExcellent], "un film d'action mais pas trop violent", { n: 10 });
  assert.strictEqual(top.length, 0, "un score potentiellement excellent sur les autres criteres ne doit JAMAIS compenser l'absence du genre obligatoire");
  console.log("TEST 12 OK — la contrainte de genre obligatoire n'est jamais diluee/compensee par d'autres criteres");
}

console.log("\n=== TOUS LES 12 TESTS DEMANDES PASSENT (+ tests structurels complementaires) ===");
