// pipeline/lib/semantic-search-engine.js
// Moteur de recherche LOCAL, isole du moteur existant (server/engine.js et
// index.html ne sont PAS touches).
//
// REGLE NULL (la plus importante) : si un critere demande par la requete
// correspond a un champ `null` chez un film, ce critere est simplement
// IGNORE pour ce film — ni bonus, ni malus, ni valeur par defaut.
//
// CONTRAINTES OBLIGATOIRES vs PREFERENCES DE RANKING (correction suite a
// l'audit du 29/08) : un genre explicitement demande ("un film d'action")
// est une contrainte DURE — un film sans ce genre est EXCLU du pool avant
// meme le scoring, il ne peut plus "gagner" via un autre critere (ex:
// violence faible). Les min/max numeriques et moods restent des preferences
// de ranking (ils influencent le score, n'excluent jamais).
"use strict";
const { passesAdultContentFilter } = require("./adult-content-audit");

// --- Vocabulaire heuristique du parseur (transparent, pas de LLM, pas de magie) ---
// NOTE : "romance" a ete retire de cette liste. Le genre Wikidata "romance"
// est souvent absent/incomplet pour des films pourtant romantiques ; exiger
// ce genre en dur exclurait a tort beaucoup de films pertinents. L'intention
// "romantique" est donc geree UNIQUEMENT via min.romance (preference de
// ranking sur le score du modele), jamais comme contrainte de genre.
const GENRE_WORDS = {
  "comédie": "comedy", "comedie": "comedy", "thriller": "thriller", "action": "action",
  "drame": "drama", "science-fiction": "scifi", "sci-fi": "scifi",
  "horreur": "horror", "policier": "crime", "polar": "crime", "aventure": "adventure",
  "fantastique": "fantasy", "documentaire": "documentary",
};

// Signaux de "mystere" a chercher dans moods/tone/themes/keywords/genres —
// liste volontairement etroite et documentee (pas un fuzzy-matcher general),
// specifique au mot "mysterieux" demande par l'utilisateur.
const MOOD_SIGNAL_TERMS = {
  mysterieux: [/myst[eè]r/i, /[eé]nigm/i, /secret/i, /suspense/i],
};

/**
 * Interprete une requete en langage naturel simple. Chaque regle est un
 * mot/expression -> un critere explicite. Rien n'est cache : cette table EST
 * la logique du parseur.
 */
function parseQuery(text) {
  const t = text.toLowerCase();
  const parsed = { required: { genres: [] }, moods: [], min: {}, max: {} };

  for (const word in GENRE_WORDS) if (t.includes(word)) parsed.required.genres.push(GENRE_WORDS[word]);

  // --- Mots -> seuils numeriques (min = "je veux beaucoup de X", max = "pas trop de X") ---
  if (t.includes("drôle") || t.includes("drole")) parsed.min.humor = 6;
  if (t.includes("tendu")) parsed.min.tension = 6;
  if (t.includes("sombre")) parsed.min.darkness = 6;
  if (t.includes("chaleureux")) parsed.min.feel_good = 6;
  if (t.includes("en famille") || t.includes("familial")) parsed.min.family_friendly = 6;
  if (t.includes("romantique")) parsed.min.romance = 6;
  if (t.includes("complexe") || t.includes("intelligent") || t.includes("fait réfléchir") || t.includes("fait reflechir")) parsed.min.complexity = 6;
  if (t.includes("beaucoup d'action") || t.includes("beaucoup d action")) parsed.min.action = 7;
  if (t.includes("violent") && !t.includes("pas trop violent") && !t.includes("peu violent")) parsed.min.violence = 6;
  if (t.includes("intense")) parsed.min.tension = Math.max(parsed.min.tension || 0, 6); // "intensity" n'existe plus dans le nouveau schema -> mappe sur tension, le plus proche
  if (t.includes("léger") || t.includes("leger")) parsed.max.darkness = 4;
  if (t.includes("feel-good") || t.includes("feelgood") || t.includes("feel good")) parsed.min.feel_good = 7;
  if (t.includes("mystérieux") || t.includes("mysterieux")) parsed.moods.push("mysterieux");

  // --- Nuances "pas trop de X" / "peu de X" -> plafond ---
  if (t.includes("pas trop violent") || t.includes("peu violent")) parsed.max.violence = 4;
  // "pas trop triste" : aucun champ "tristesse" n'existe dans notre schema.
  // Represente par son inverse le plus proche disponible : feel_good pas trop bas.
  if (t.includes("pas trop triste")) parsed.min.feel_good = Math.max(parsed.min.feel_good || 0, 5);
  if (t.includes("peu de romance")) parsed.max.romance = 3;

  return parsed;
}

/**
 * Score un film pour une requete deja interpretee (le film a DEJA passe les
 * contraintes obligatoires — voir search()). contributions liste UNIQUEMENT
 * les criteres reellement evalues (jamais ceux ignores a cause d'un null).
 *
 * FORMULE : somme des points obtenus, rapportee a un denominateur FIXE base
 * sur le nombre de criteres DEMANDES PAR LA REQUETE (pas sur combien ont pu
 * etre evalues pour ce film precis). Corrige un defaut trouve lors de
 * l'audit du 29/08 : avec une simple MOYENNE, satisfaire un critere
 * supplementaire pouvait paradoxalement FAIRE BAISSER le score. Avec une
 * somme/denominateur fixe, ajouter un critere satisfait ne peut plus jamais
 * faire baisser le score — au pire un null n'ajoute rien (jamais negatif).
 * Consequence assumee et documentee : un film avec plus de null sur les
 * dimensions demandees plafonne plus bas (moins d'information disponible),
 * sans que null soit jamais compte comme une valeur negative en soi.
 */
function scoreMovie(movie, parsed) {
  const p = movie.semantic_profile || {};
  const contributions = [];
  const criteriaRequested = parsed.moods.length + Object.keys(parsed.min).length + Object.keys(parsed.max).length;

  if (criteriaRequested === 0) return { total: 0, contributions: [], criteriaEvaluated: 0, criteriaRequested: 0, note: "aucun critere dans la requete" };

  if (parsed.moods.length) {
    const haystack = [...(p.moods || []), ...(p.tone || []), ...(p.themes || []), ...(p.keywords || []), ...(movie.facts.genres || [])];
    for (const mood of parsed.moods) {
      const patterns = MOOD_SIGNAL_TERMS[mood];
      if (!patterns) continue;
      const hit = haystack.some(field => patterns.some(re => re.test(field)));
      if (hit) contributions.push({ critere: `mood: ${mood}`, valeur: "signal present", points: 8 });
    }
  }

  for (const field in parsed.min) {
    const v = p[field];
    if (v === null || v === undefined) continue; // REGLE NULL : ignore, jamais 0, jamais une valeur inventee
    contributions.push({ critere: `min_${field}`, valeur: v, points: v }); // plus v est haut, mieux ca correspond a "je veux du X"
  }
  for (const field in parsed.max) {
    const v = p[field];
    if (v === null || v === undefined) continue; // meme regle
    contributions.push({ critere: `max_${field}`, valeur: v, points: 10 - v }); // plus v est bas, mieux ca correspond a "pas trop de X"
  }

  if (contributions.length === 0) return { total: 0, contributions: [], criteriaEvaluated: 0, criteriaRequested, note: "aucun critere evaluable pour ce film (tout etait null ou hors sujet)" };

  const sum = contributions.reduce((a, c) => a + c.points, 0);
  const maxPossible = criteriaRequested * 10; // denominateur FIXE : base sur la requete, pas sur ce film
  const total = Math.round((sum / maxPossible) * 100);
  return { total, contributions, criteriaEvaluated: contributions.length, criteriaRequested };
}

/**
 * Recherche complete, dans cet ordre exact :
 *   1. filtre adulte (contrainte dure — cf. adult-content-audit.js)
 *   2. contraintes de genre obligatoires (contrainte dure)
 *   3. scoring des survivants
 *   4. tri
 * Un film exclu aux etapes 1-2 n'entre JAMAIS dans le calcul du score.
 */
function search(movies, queryText, { n = 10, excludeAdultContent = true } = {}) {
  const parsed = parseQuery(queryText);

  let pool = movies.filter(m => !m._profileInvalid);

  const excludedAdultCount = pool.filter(m => !passesAdultContentFilter(m)).length;
  if (excludeAdultContent) pool = pool.filter(passesAdultContentFilter);

  let excludedByGenre = 0;
  if (parsed.required.genres.length) {
    const beforeGenre = pool.length;
    pool = pool.filter(m => parsed.required.genres.some(g => (m.facts.genres || []).includes(g)));
    excludedByGenre = beforeGenre - pool.length;
  }

  const scored = pool.map(m => ({ movie: m, result: scoreMovie(m, parsed) }));
  scored.sort((a, b) => b.result.total - a.result.total);

  return {
    parsed,
    excludedAdultCount,
    excludedByGenre,
    top: scored.slice(0, n),
  };
}

module.exports = { parseQuery, scoreMovie, search, GENRE_WORDS, MOOD_SIGNAL_TERMS };
