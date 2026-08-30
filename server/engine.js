// server/engine.js
// Port serveur du moteur de scoring (mêmes règles que pipeline/ et l'artefact
// client, cf. brief §9). Fonctionne sur des lignes Postgres (colonnes snake_case).
"use strict";

const WEIGHTS = {
  SEARCH_MATCH_WEIGHT: 40,
  SEARCH_FIT_WEIGHT: 25,
  QUALITY_WEIGHT: 15,
  PERSONALIZATION_WEIGHT: 15,
  POPULARITY_WEIGHT: 5,
};

const PALETTE = [
  "linear-gradient(135deg,#2a2a3a,#5a4a8a)", "linear-gradient(135deg,#3a2a1a,#8a6a2a)",
  "linear-gradient(135deg,#1a3a3a,#2a7a7a)", "linear-gradient(135deg,#5a1a3a,#c9a227)",
  "linear-gradient(135deg,#1a3a5a,#c9a227)", "linear-gradient(135deg,#3a1a1a,#7a3a3a)",
];
function colorFor(id) {
  let seed = 0; for (const c of String(id)) seed += c.charCodeAt(0);
  return PALETTE[seed % PALETTE.length];
}

function passesHardConstraints(movie, parsed) {
  if (parsed.max_runtime && movie.runtime_minutes && movie.runtime_minutes > parsed.max_runtime) return false;
  if (parsed.actors && parsed.actors.length) {
    const actors = movie.actors || [];
    const hasActor = actors.some(a => parsed.actors.some(pa => a.toLowerCase().includes(pa)));
    if (!hasActor) return false;
  }
  return true;
}

function getStats(movie, statsByMovieId) {
  const s = statsByMovieId.get(movie.id);
  if (!s || s.quality_count == 0) return { qualityAvg: 3.5, qualityCount: 0, fitAvg: 3.5, fitCount: 0, likePct: 65 };
  const fitCount = Number(s.fit_count) || 0;
  const likePct = fitCount ? Math.round((Number(s.like_count) / fitCount) * 100) : 65;
  return {
    qualityAvg: Number(s.quality_avg) || 3.5,
    qualityCount: Number(s.quality_count) || 0,
    fitAvg: Number(s.fit_avg) || 3.5,
    fitCount,
    likePct,
  };
}

function buildProfile(profileRows) {
  const genreStats = {}, runtimes = [];
  for (const row of profileRows) {
    const genres = row.genres || [];
    genres.forEach(g => {
      if (!genreStats[g]) genreStats[g] = { sum: 0, count: 0 };
      genreStats[g].sum += row.movie_quality_rating;
      genreStats[g].count += 1;
    });
    if (row.runtime_minutes) runtimes.push({ runtime: row.runtime_minutes, rating: row.movie_quality_rating });
  }
  let preferredRuntime = null;
  if (runtimes.length) {
    const weighted = runtimes.reduce((a, r) => a + r.runtime * r.rating, 0);
    const weightSum = runtimes.reduce((a, r) => a + r.rating, 0) || 1;
    preferredRuntime = weighted / weightSum;
  }
  return { genreStats, preferredRuntime };
}

function scoreMovie(movie, parsed, profile, statsByMovieId) {
  let match = 0, maxMatch = 0;
  const genres = movie.genres || [];
  if (parsed.genres && parsed.genres.length) {
    maxMatch += 40; if (genres.some(g => parsed.genres.includes(g))) match += 40;
  }
  if (parsed.moods && parsed.moods.length) {
    maxMatch += 25;
    const overlap = (movie.moods || []).filter(m => parsed.moods.includes(m)).length;
    match += Math.min(25, overlap * 13);
  }
  if (parsed.countries && parsed.countries.length) {
    maxMatch += 10; if ((movie.countries || []).some(c => parsed.countries.includes(c))) match += 10;
  }
  if (parsed.actors && parsed.actors.length) {
    maxMatch += 15;
    if ((movie.actors || []).some(a => parsed.actors.some(pa => a.toLowerCase().includes(pa)))) match += 15;
  }
  if (parsed.year_min || parsed.year_max) {
    maxMatch += 10;
    const okMin = !parsed.year_min || movie.year >= parsed.year_min;
    const okMax = !parsed.year_max || movie.year <= parsed.year_max;
    if (okMin && okMax) match += 10;
  }
  maxMatch = maxMatch || 1;
  let searchMatch = (match / maxMatch) * 100;
  if (parsed.max_violence != null && movie.violence > parsed.max_violence) searchMatch *= 0.4;
  if (parsed.max_intensity != null && movie.intensity > parsed.max_intensity) searchMatch *= 0.5;
  if (parsed.max_complexity != null && movie.complexity > parsed.max_complexity) searchMatch *= 0.6;
  if (parsed.min_humor != null && movie.humor < parsed.min_humor) searchMatch *= 0.6;

  const stats = getStats(movie, statsByMovieId);
  const searchFit = (stats.fitAvg / 5) * 100;
  const quality = (stats.qualityAvg / 5) * 100;

  let personalization = 50;
  const gStat = genres.map(g => profile.genreStats[g]).filter(Boolean);
  if (gStat.length) {
    const avg = gStat.reduce((a, s) => a + s.sum / s.count, 0) / gStat.length;
    personalization = (avg / 5) * 100;
  }
  if (profile.preferredRuntime && movie.runtime_minutes) {
    const diff = Math.abs(movie.runtime_minutes - profile.preferredRuntime);
    personalization = personalization * 0.7 + Math.max(0, 100 - diff) * 0.3;
  }

  const popularity = Math.min(100, Math.log10(stats.qualityCount + 1) * 28);

  const total =
    searchMatch * (WEIGHTS.SEARCH_MATCH_WEIGHT / 100) +
    searchFit * (WEIGHTS.SEARCH_FIT_WEIGHT / 100) +
    quality * (WEIGHTS.QUALITY_WEIGHT / 100) +
    personalization * (WEIGHTS.PERSONALIZATION_WEIGHT / 100) +
    popularity * (WEIGHTS.POPULARITY_WEIGHT / 100);

  return { total, searchMatch, searchFit, quality, personalization, popularity, stats };
}

/** Adapte une ligne Postgres au format attendu par le rendu client (Card()/whyText()). */
function toClientShape(movie) {
  return {
    id: movie.id,
    title: movie.title,
    year: movie.year,
    runtime: movie.runtime_minutes || 105,
    country: (movie.countries || [])[0] || "—",
    genres: movie.genres || [],
    director: (movie.directors || [])[0] || "Inconnu",
    actors: movie.actors || [],
    synopsis: movie.synopsis || movie.synopsis_raw || `${movie.title} — synopsis non disponible.`,
    moods: movie.moods || [],
    intensity: movie.intensity ?? 4, humor: movie.humor ?? 3, romance: movie.romance ?? 2,
    action: movie.action ?? 2, violence: movie.violence ?? 2, complexity: movie.complexity ?? 4,
    feel_good: movie.feel_good ?? 4,
    good_for: movie.good_for || [],
    tags: movie.tags || [],
    color: colorFor(movie.id),
    sourceLive: true,
  };
}

function recommend({ candidates, statsByMovieId, profileRows, excludeIds, watchedIds, parsed, n = 3 }) {
  const profile = buildProfile(profileRows);
  let pool = candidates.filter(m => !excludeIds.has(m.id) && !watchedIds.has(m.id));
  const hardFiltered = pool.filter(m => passesHardConstraints(m, parsed));
  const relaxed = hardFiltered.length === 0 && pool.length > 0;
  if (!relaxed) pool = hardFiltered;

  const scored = pool.map(m => ({ movie: m, score: scoreMovie(m, parsed, profile, statsByMovieId) }));
  scored.sort((a, b) => b.score.total - a.score.total);
  const top = scored.slice(0, n);

  return top.map(r => ({
    movie: toClientShape(r.movie),
    score: { total: r.score.total },
    stats: {
      qualityAvg: r.score.stats.qualityAvg, qualityCount: r.score.stats.qualityCount,
      fitAvg: r.score.stats.fitAvg, fitCount: r.score.stats.fitCount, likePct: r.score.stats.likePct,
    },
    relaxed,
  }));
}

module.exports = { recommend, passesHardConstraints, scoreMovie, buildProfile };
