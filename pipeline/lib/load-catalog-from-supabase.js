// pipeline/lib/load-catalog-from-supabase.js
// PHASE 4 de la migration. Renvoie EXACTEMENT la meme forme que loadCatalog()
// (fichier JSON) -- {movies, stats} -- de sorte que movie-search-v3.js ne
// voit STRICTEMENT aucune difference selon la source. Contrairement au mode
// JSON, introText/synopsisOnlyText sont DEJA fusionnes ici (Supabase les
// stocke directement, voir pipeline/supabase-movies-schema.sql) -- le
// serveur n'a donc plus besoin du fichier wikipedia-synopsis-1018.json
// separe quand cette source est utilisee.
"use strict";
const { isProfileStructurallyValid, sortByWikidataId } = require("./local-catalog");

function rowToMovie(row) {
  return {
    movie_id: row.movie_id,
    wikidata_id: row.wikidata_id,
    title: row.title,
    facts: {
      year: row.year, runtime_minutes: row.runtime_minutes,
      countries: row.countries || [], genres: row.genres || [],
      directors: row.directors || [], actors: row.actors || [],
    },
    source: { wikipedia_language: row.wikipedia_language, wikipedia_title: row.wikipedia_title },
    semantic_profile: row.semantic_profile || {},
    semantic_status: row.semantic_status,
    semantic_warnings: row.semantic_warnings || [],
    adult_content: row.adult_content || {},
    introText: row.intro_text || "",
    synopsisOnlyText: row.synopsis_text || "",
  };
}

async function loadCatalogFromSupabase(pool) {
  const { rows } = await pool.query("select * from movies_catalog");
  const movies = sortByWikidataId(rows.map(rowToMovie)); // MEME fonction de tri que le mode JSON -- ordre garanti identique

  const seen = new Set();
  const duplicates = [];
  let invalidProfileCount = 0;

  for (const movie of movies) {
    if (seen.has(movie.wikidata_id)) duplicates.push(movie.wikidata_id);
    seen.add(movie.wikidata_id);
    if (movie.semantic_profile && Object.keys(movie.semantic_profile).length && !isProfileStructurallyValid(movie.semantic_profile)) {
      invalidProfileCount++;
      movie._profileInvalid = true;
    }
  }

  return {
    movies,
    stats: {
      total: movies.length,
      duplicateWikidataIds: duplicates,
      duplicateCount: duplicates.length,
      invalidProfileCount,
      withSemanticProfile: movies.filter(m => m.semantic_status === "success").length,
    },
  };
}

module.exports = { loadCatalogFromSupabase, rowToMovie };
