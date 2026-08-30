#!/usr/bin/env node
// server/semantic-search.js
// node server/semantic-search.js   (ecoute sur SEMANTIC_PORT, 3002 par defaut)
//
// Serveur DEDIE et SEPARE du serveur existant (server/index.js + engine.js,
// tous deux INTACTS et non modifies). Sert le nouveau moteur local
// (pipeline/lib/semantic-search-engine.js) sur le catalogue JSON
// semantic-enrichment-1018-final.json — aucune dependance Supabase, aucun
// appel Ollama. Entierement REVERSIBLE : ne pas lancer ce process = aucun
// changement de comportement du prototype existant (index.html retombe sur
// son fonctionnement habituel si ce serveur ne repond pas).
"use strict";
const express = require("express");
const cors = require("cors");
const path = require("path");
const { loadCatalog } = require("../pipeline/lib/local-catalog");
const { search } = require("../pipeline/lib/semantic-search-engine");

const PORT = process.env.SEMANTIC_PORT || 3002;
const CATALOG_PATH = process.env.SEMANTIC_CATALOG || path.join(__dirname, "..", "pipeline", "test-results", "semantic-enrichment-1018-final.json");

let CATALOG = null;
let CATALOG_STATS = null;
function ensureCatalog() {
  if (!CATALOG) {
    const { movies, stats } = loadCatalog(CATALOG_PATH);
    CATALOG = movies;
    CATALOG_STATS = stats;
    console.log(`Catalogue semantique charge : ${stats.total} films (${stats.duplicateCount} doublons, ${stats.invalidProfileCount} profils invalides).`);
  }
  return CATALOG;
}

/** Adapte un film du catalogue final vers la forme attendue par le rendu client existant (Card() dans index.html). Jamais de valeur inventee pour un null : passe tel quel. */
function toClientShape(movie) {
  const p = movie.semantic_profile || {};
  return {
    id: movie.wikidata_id,
    title: movie.title,
    year: movie.facts.year,
    runtime: movie.facts.runtime_minutes || 105,
    country: (movie.facts.countries || [])[0] || "—",
    genres: movie.facts.genres || [],
    director: (movie.facts.directors || [])[0] || "Inconnu",
    actors: movie.facts.actors || [],
    synopsis: `${movie.title} — synopsis non stocke dans ce catalogue de test (donnees semantiques uniquement).`,
    moods: p.moods || [], tone: p.tone || [], themes: p.themes || [], keywords: p.keywords || [],
    humor: p.humor, action: p.action, violence: p.violence, tension: p.tension,
    romance: p.romance, emotional: p.emotional, complexity: p.complexity,
    feel_good: p.feel_good, darkness: p.darkness, family_friendly: p.family_friendly,
    good_for: p.good_for || [], // affichable a titre informatif ; NE participe jamais au score (cf. engine)
    tags: p.keywords || [],
    color: "linear-gradient(135deg,#2a2a3a,#5a4a8a)",
    sourceLive: true,
  };
}

/** Explication courte et lisible, construite UNIQUEMENT a partir des contributions reelles du score (jamais good_for, jamais une mecanique interne exposee en detail). */
function explainResult(result) {
  if (!result.contributions.length) return "Correspondance generale (peu de criteres precis disponibles pour ce film).";
  return result.contributions
    .map(c => c.critere.replace(/^min_/, "").replace(/^max_/, "").replace(/^mood: /, ""))
    .join(", ");
}

const CANDIDATE_POOL_SIZE = 40; // classement interne plus large, pour permettre plusieurs "3 autres" sans repetition
const DISPLAY_COUNT = 3; // nombre reellement renvoye/affiche par appel — conforme au concept original (3 choix, pas 10)

/** Logique de la route, extraite pour etre testable hors-ligne sans lancer un vrai serveur HTTP. */
function handleSemanticSearch(movies, body) {
  const { query, excludeIds = [] } = body || {};
  if (!query) return { status: 400, body: { error: "query requis" } };

  const { parsed, excludedAdultCount, excludedByGenre, top } = search(movies, query, { n: CANDIDATE_POOL_SIZE });
  // L'exclusion des films deja vus se fait sur le BASSIN LARGE (40), avant de ne garder que les 3 a afficher —
  // et non plus sur un top 10 deja epuise, ce qui causait la repetition sur "3 autres".
  const freshCandidates = top.filter(r => !excludeIds.includes(r.movie.wikidata_id));
  const displayed = freshCandidates.slice(0, DISPLAY_COUNT);

  return {
    status: 200,
    body: {
      parsed, excludedAdultCount, excludedByGenre,
      hasMore: freshCandidates.length > DISPLAY_COUNT,
      results: displayed.map(r => ({
        movie: toClientShape(r.movie),
        score: { total: r.result.total },
        explanation: explainResult(r.result),
        criteriaEvaluated: r.result.criteriaEvaluated,
        criteriaRequested: r.result.criteriaRequested,
      })),
    },
  };
}

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (req, res) => {
    try { const movies = ensureCatalog(); res.json({ ok: true, catalogSize: movies.length }); }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post("/api/semantic-search", (req, res) => {
    try {
      const movies = ensureCatalog();
      const { status, body } = handleSemanticSearch(movies, req.body);
      res.status(status).json(body);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => console.log(`Moteur semantique local sur http://localhost:${PORT} (catalogue: ${CATALOG_PATH})`));
}

module.exports = { createApp, handleSemanticSearch, toClientShape, explainResult, ensureCatalog };
