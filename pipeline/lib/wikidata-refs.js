// pipeline/lib/wikidata-refs.js
// Logique PURE (aucun accès réseau/base ici) de gestion du statut de
// résolution progressive des références Wikidata. Testable hors-ligne.
"use strict";

const { mapGenreLabel } = require("./wikidata-api");

const ESSENTIAL_CATEGORIES = ["genres", "directors", "countries", "actors"];
const MAX_ATTEMPTS = 3;

/**
 * Calcule le statut d'un film à partir de l'état réel de ses références
 * non résolues — jamais de l'historique des tentatives. Une catégorie sans
 * aucune référence en attente est "réglée", qu'elle ait été résolue ou
 * qu'elle soit simplement absente chez Wikidata.
 */
function computeRefStatus(unresolvedRefs) {
  const settledCount = ESSENTIAL_CATEGORIES.filter(
    cat => !(unresolvedRefs[cat] && unresolvedRefs[cat].length)
  ).length;
  if (settledCount === ESSENTIAL_CATEGORIES.length) return "complete";
  if (settledCount > 0) return "enriched";
  return "fetched";
}

/** Construit la structure unresolved_refs initiale à partir des références brutes extraites. */
function buildInitialUnresolvedRefs(raw) {
  return {
    genres: [...raw.genre_refs],
    directors: [...raw.director_refs],
    countries: [...raw.country_refs],
    actors: [...raw.cast_refs],
  };
}

/**
 * Applique le résultat d'une passe de résolution (cache de libellés) sur un
 * film : déplace les ids résolus vers les tableaux de noms, et les ids ayant
 * atteint MAX_ATTEMPTS sans succès vers unresolvable_refs. Retourne les
 * nouvelles valeurs à écrire en base, ou null si rien n'a changé pour ce film.
 *
 * @param movie { genres, directors, countries, actors, unresolved_refs, unresolvable_refs }
 * @param labelCache Map<qid, {label: string|null, attempts: number, resolved: boolean}>
 */
function applyResolution(movie, labelCache) {
  let changed = false;
  const resolvedNames = {
    genres: [...(movie.genres || [])],
    directors: [...(movie.directors || [])],
    countries: [...(movie.countries || [])],
    actors: [...(movie.actors || [])],
  };
  const unresolved = {};
  const unresolvable = {
    genres: [...((movie.unresolvable_refs && movie.unresolvable_refs.genres) || [])],
    directors: [...((movie.unresolvable_refs && movie.unresolvable_refs.directors) || [])],
    countries: [...((movie.unresolvable_refs && movie.unresolvable_refs.countries) || [])],
    actors: [...((movie.unresolvable_refs && movie.unresolvable_refs.actors) || [])],
  };

  for (const cat of ESSENTIAL_CATEGORIES) {
    const pending = (movie.unresolved_refs && movie.unresolved_refs[cat]) || [];
    const stillPending = [];
    for (const qid of pending) {
      const cached = labelCache.get(qid);
      if (!cached) { stillPending.push(qid); continue; } // pas encore traité dans cette passe
      if (cached.resolved && cached.label) {
        // Le genre est un cas particulier : son libellé brut Wikidata doit être
        // ramené à notre vocabulaire interne (comedy/action/...). S'il ne
        // correspond à rien de connu, l'id est quand même considéré "réglé"
        // (on l'a bien résolu) — simplement pas ajouté à la liste de genres.
        const value = cat === "genres" ? mapGenreLabel(cached.label) : cached.label;
        if (value && !resolvedNames[cat].includes(value)) resolvedNames[cat].push(value);
        changed = true;
      } else if (cached.attempts >= MAX_ATTEMPTS) {
        if (!unresolvable[cat].includes(qid)) unresolvable[cat].push(qid);
        changed = true;
      } else {
        stillPending.push(qid); // échec temporaire, on retentera à la prochaine passe
      }
    }
    unresolved[cat] = stillPending;
  }

  if (!changed) return null;

  return {
    genres: resolvedNames.genres, directors: resolvedNames.directors,
    countries: resolvedNames.countries, actors: resolvedNames.actors,
    unresolved_refs: unresolved, unresolvable_refs: unresolvable,
    wikidata_ref_status: computeRefStatus(unresolved),
  };
}

/** Tous les Q-ids encore réellement en attente (hors cache) pour un lot de films. */
function collectPendingIds(movies) {
  const set = new Set();
  for (const m of movies) {
    for (const cat of ESSENTIAL_CATEGORIES) {
      ((m.unresolved_refs && m.unresolved_refs[cat]) || []).forEach(qid => set.add(qid));
    }
  }
  return [...set];
}

module.exports = { ESSENTIAL_CATEGORIES, MAX_ATTEMPTS, computeRefStatus, buildInitialUnresolvedRefs, applyResolution, collectPendingIds };
