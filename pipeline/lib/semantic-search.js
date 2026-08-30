// pipeline/lib/semantic-search.js
// Logique PURE (aucun reseau ici) : interprete une requete en langage
// naturel simple (heuristique, pas de LLM ici) et score les profils
// semantiques generes pour tester leur pertinence. Testable hors-ligne.
"use strict";

/** Interpretation heuristique tres simple d'une requete (suffisante pour ce test de pertinence). */
function parseQuery(text) {
  const t = text.toLowerCase();
  const parsed = {
    moods: [], genres: [], max_runtime: null, max_violence: null,
    min_feel_good: null, min_humor: null, min_suspense: null, min_action: null,
    min_romance: null, country: null, year_min: null, year_max: null, actor: null,
    prefer_family: false,
  };
  if (t.includes("drôle") || t.includes("comédie")) { parsed.genres.push("comedy"); parsed.min_humor = 5; }
  if (t.includes("léger")) parsed.moods.push("leger");
  if (t.includes("sombre")) parsed.moods.push("sombre");
  if (t.includes("thriller")) parsed.genres.push("thriller");
  if (t.includes("suspense")) parsed.min_suspense = 6;
  if (t.includes("action")) parsed.genres.push("action");
  if (t.includes("pas trop violent")) parsed.max_violence = 4;
  if (t.includes("français")) parsed.country = "France";
  if (t.includes("années 2010")) { parsed.year_min = 2010; parsed.year_max = 2019; }
  if (t.includes("pas déprimant")) parsed.min_feel_good = 4;
  if (t.includes("moins de 2h") || t.includes("moins de 2 heures")) parsed.max_runtime = 120;
  if (t.includes("russell crowe")) parsed.actor = "russell crowe";
  if (t.includes("familial") || t.includes("enfants")) parsed.prefer_family = true;
  if (t.includes("science-fiction") || t.includes("science fiction")) parsed.genres.push("scifi");
  if (t.includes("fait réfléchir")) parsed.moods.push("reflexif");
  if (t.includes("romantique")) { parsed.genres.push("romance"); parsed.min_romance = 5; }
  if (t.includes("émouvant")) parsed.moods.push("emouvant");
  return parsed;
}

/** Score un film (facts Wikidata + profil semantique) par rapport a une requete interpretee. Renvoie {score, reasons[]} ou null si exclu par une contrainte dure. */
function scoreFilm(film, parsed) {
  // Contraintes dures : jamais compensees par un bon score ailleurs
  if (parsed.max_runtime && film.runtime_minutes && film.runtime_minutes > parsed.max_runtime) return null;
  if (parsed.actor && !(film.actors || []).some(a => a.toLowerCase().includes(parsed.actor))) return null;
  if (parsed.country && !(film.countries || []).includes(parsed.country)) return null;
  if (parsed.year_min && (!film.year || film.year < parsed.year_min || film.year > parsed.year_max)) return null;

  let score = 0;
  const reasons = [];
  const p = film.semantic_profile || {};

  if (parsed.genres.length) {
    const hit = parsed.genres.filter(g => (film.genres || []).includes(g));
    if (hit.length) { score += 30 * hit.length; reasons.push(`genre(s) ${hit.join(", ")}`); }
  }
  if (parsed.moods.length) {
    const hit = parsed.moods.filter(m => (p.moods || []).includes(m));
    if (hit.length) { score += 15 * hit.length; reasons.push(`mood(s) ${hit.join(", ")}`); }
  }
  if (parsed.min_humor && p.humor >= parsed.min_humor) { score += p.humor * 2; reasons.push(`humor=${p.humor}`); }
  if (parsed.min_suspense && p.suspense >= parsed.min_suspense) { score += p.suspense * 2; reasons.push(`suspense=${p.suspense}`); }
  if (parsed.min_romance != null && p.romance >= parsed.min_romance) { score += p.romance; reasons.push(`romance=${p.romance}`); }
  if (parsed.min_feel_good && p.feel_good >= parsed.min_feel_good) { score += p.feel_good; reasons.push(`feel_good=${p.feel_good}`); }
  if (parsed.max_violence != null) {
    if (p.violence <= parsed.max_violence) { score += (10 - p.violence); reasons.push(`violence=${p.violence} (faible)`); }
    else score -= (p.violence - parsed.max_violence) * 3; // penalise sans exclure (contrainte "privilegier", pas stricte)
  }
  if (parsed.prefer_family) {
    score += Math.max(0, 10 - p.violence) + Math.max(0, 10 - p.darkness);
    reasons.push(`peu violent/sombre (violence=${p.violence}, darkness=${p.darkness})`);
  }
  if (parsed.moods.includes("emouvant") && p.emotional_intensity) { score += p.emotional_intensity; reasons.push(`emotional_intensity=${p.emotional_intensity}`); }
  if (parsed.moods.includes("reflexif") && p.complexity) { score += p.complexity; reasons.push(`complexity=${p.complexity}`); }
  if (parsed.moods.includes("sombre") && p.darkness) { score += p.darkness; reasons.push(`darkness=${p.darkness}`); }
  if (parsed.moods.includes("leger")) { score += Math.max(0, 10 - p.intensity); reasons.push(`intensity=${p.intensity} (leger)`); }

  return { score, reasons };
}

function runQuery(text, films, n = 3) {
  const parsed = parseQuery(text);
  const scored = films
    .map(f => ({ film: f, result: scoreFilm(f, parsed) }))
    .filter(x => x.result !== null)
    .sort((a, b) => b.result.score - a.result.score);
  return { parsed, top: scored.slice(0, n) };
}

module.exports = { parseQuery, scoreFilm, runQuery };
