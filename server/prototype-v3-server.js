#!/usr/bin/env node
// server/prototype-v3-server.js
// node server/prototype-v3-server.js   (port 3003 par defaut)
//
// Serveur DEDIE au prototype de test V3. Utilise movie-search-v3.js SANS LE
// MODIFIER. Aucune ecriture Supabase — le feedback est stocke dans un
// fichier JSON local uniquement. Aucun Ollama. Totalement separe des autres
// serveurs (server/index.js, server/semantic-search.js) — reversible, rien
// d'existant n'est touche.
"use strict";
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { loadCatalog } = require("../pipeline/lib/local-catalog");
const { loadCatalogFromSupabase } = require("../pipeline/lib/load-catalog-from-supabase");
const { buildGazetteer } = require("../pipeline/lib/entity-gazetteer");
const { searchV3 } = require("../pipeline/lib/movie-search-v3"); // INCHANGE, importe tel quel
const { saveFeedbackToSupabase } = require("./feedback-store-supabase");
const { Pool } = require("pg");

const PORT = process.env.PROTOTYPE_PORT || 3003;
const CATALOG_SOURCE = process.env.CATALOG_SOURCE || "json"; // "json" par defaut pendant la migration -- jamais bascule silencieusement
const RESULTS_DIR = path.join(__dirname, "..", "pipeline", "test-results");
const FINAL_CATALOG_PATH = process.env.PROTOTYPE_CATALOG || path.join(RESULTS_DIR, "semantic-enrichment-1018-final.json");
const WIKIPEDIA_PATH = path.join(RESULTS_DIR, "wikipedia-synopsis-1018.json");
const EMB_CACHE_SYNOPSIS = path.join(RESULTS_DIR, "embeddings-cache-v2-synopsis.json");
const EMB_CACHE_INTRO = path.join(RESULTS_DIR, "embeddings-cache-v2-intro.json");
const FEEDBACK_LOG_PATH = path.join(RESULTS_DIR, "feedback-log.json");

function loadJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return fallback; } }
function saveJsonAtomic(p, obj) { const tmp = `${p}.tmp`; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, p); }

let CATALOG = null, GAZETTEER = null, EMB_OPTS = {};

function buildTextFields(finalCatalogMovies, wikipediaResults) {
  const byWikidataId = new Map(wikipediaResults.map(r => [r.wikidata_id, r]));
  return finalCatalogMovies.map(m => {
    const r = byWikidataId.get(m.wikidata_id);
    const data = r ? (r.lang_used === "fr" ? r.fr : r.en) : null;
    return { ...m, introText: data && data.intro ? data.intro : "", synopsisOnlyText: data && data.synopsis_text ? data.synopsis_text : "" };
  });
}

async function ensureLoaded() {
  if (CATALOG) return;

  if (CATALOG_SOURCE === "supabase") {
    if (!process.env.DATABASE_URL) throw new Error("CATALOG_SOURCE=supabase mais DATABASE_URL n'est pas definie -- aucun fallback silencieux, corrige la configuration ou repasse a CATALOG_SOURCE=json.");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { movies } = await loadCatalogFromSupabase(pool); // introText/synopsisOnlyText DEJA fusionnes cote Supabase
    CATALOG = movies;
  } else if (CATALOG_SOURCE === "json") {
    const { movies } = loadCatalog(FINAL_CATALOG_PATH);
    const wikipediaResults = JSON.parse(fs.readFileSync(WIKIPEDIA_PATH, "utf8"));
    CATALOG = buildTextFields(movies, wikipediaResults);
  } else {
    throw new Error(`CATALOG_SOURCE invalide : "${CATALOG_SOURCE}" (attendu "json" ou "supabase") -- aucun fallback silencieux.`);
  }
  GAZETTEER = buildGazetteer(CATALOG);

  const embCacheSynopsis = loadJson(EMB_CACHE_SYNOPSIS, {});
  const embCacheIntro = loadJson(EMB_CACHE_INTRO, {});
  if (Object.keys(embCacheSynopsis).length || Object.keys(embCacheIntro).length) {
    const embModule = require("../pipeline/lib/embeddings");
    EMB_OPTS = {
      embeddingLookup: (field, id) => (field === "intro" ? embCacheIntro : embCacheSynopsis)[id] || null,
      queryEmbedFn: embModule.embed, cosineSimilarity: embModule.cosineSimilarity,
    };
  }
  console.log(`Catalogue V3 charge : ${CATALOG.length} films.`);
}

/** Resume succinct depuis les VRAIES donnees deja presentes — aucune generation, aucun Ollama. */
function shortSynopsis(movie) {
  const text = movie.synopsisOnlyText || movie.introText || "";
  if (!text) return "(résumé non disponible dans le catalogue)";
  return text.trim(); // synopsis complet, jamais coupe
}

function toClientShape(movie, rank) {
  return {
    id: movie.wikidata_id,
    title: movie.title,
    year: movie.facts.year || null,
    runtimeMinutes: movie.facts.runtime_minutes || null, // null si absent des donnees, jamais une duree inventee
    directors: movie.facts.directors || [],
    actors: (movie.facts.actors || []).slice(0, 5),
    synopsis: shortSynopsis(movie),
    rank,
  };
}

/** Logique de recherche extraite, pure et testable — bassin large en interne
 * (via le parametre `n` deja supporte par searchV3, aucune modification du
 * moteur), exclusion des films deja vus APRES le classement, puis limite a
 * DISPLAY_COUNT pour l'affichage. */
const CANDIDATE_POOL_SIZE = 40;
const DISPLAY_COUNT = 3; // conforme au principe "quelques films pertinents, pas 50"

async function handleSearch(catalog, gazetteer, embOpts, body) {
  const { query, excludeIds = [] } = body || {};
  if (!query) return { status: 400, body: { error: "query requis" } };

  const result = await searchV3(catalog, gazetteer, query, { ...embOpts, n: CANDIDATE_POOL_SIZE });
  const fresh = result.ranked.filter(r => !excludeIds.includes(r.movie.wikidata_id));
  const displayed = fresh.slice(0, DISPLAY_COUNT);

  return {
    status: 200,
    body: {
      filters: result.filters, semantic_query: result.semantic_query, family: result.family,
      pool_size: result.pool_size,
      hasMore: fresh.length > DISPLAY_COUNT,
      results: displayed.map((r, i) => ({ movie: toClientShape(r.movie, i + 1), score: r.total, detail: r.detail })),
    },
  };
}

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  // Sert UNIQUEMENT les fichiers frontend explicitement necessaires — jamais
  // le dossier racine entier (qui exposerait le catalogue, le code serveur,
  // et un eventuel .env). Chaque fichier est nomme explicitement.
  const PROJECT_ROOT = path.join(__dirname, "..");
  app.get("/prototype-v3.html", (req, res) => res.sendFile(path.join(PROJECT_ROOT, "prototype-v3.html")));
  app.get("/prototype-v3-helpers.js", (req, res) => res.sendFile(path.join(PROJECT_ROOT, "prototype-v3-helpers.js")));
  app.get("/", (req, res) => res.sendFile(path.join(PROJECT_ROOT, "prototype-v3.html")));

  app.get("/api/health", async (req, res) => {
    try {
      await ensureLoaded();
      res.json({ ok: true, catalogSize: CATALOG.length, catalogSource: CATALOG_SOURCE });
    }
    catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post("/api/search", async (req, res) => {
    try {
      await ensureLoaded();
      const { status, body } = await handleSearch(CATALOG, GAZETTEER, EMB_OPTS, req.body);
      res.status(status).json(body);
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/feedback", (req, res) => {
    try {
      const { query, filmId, filmTitle, position, score, relevanceRating, filmRating, irrelevanceReasons, sessionId } = req.body;
      if (!query || !filmId) {
        return res.status(400).json({ error: "query et filmId sont requis" });
      }
      if (relevanceRating == null && filmRating == null) {
        return res.status(400).json({ error: "au moins une des deux notes (pertinence ou film) est requise" });
      }
      if ((relevanceRating != null && (relevanceRating < 1 || relevanceRating > 5)) || (filmRating != null && (filmRating < 1 || filmRating > 5))) {
        return res.status(400).json({ error: "une note fournie doit être entre 1 et 5" });
      }
      if (irrelevanceReasons != null && !Array.isArray(irrelevanceReasons)) {
        return res.status(400).json({ error: "irrelevanceReasons doit être un tableau (plusieurs raisons possibles)" });
      }
      const entry = {
        query, filmId, filmTitle: filmTitle || null, position: position ?? null, score: score ?? null,
        relevanceRating: relevanceRating ?? null, filmRating: filmRating ?? null,
        irrelevanceReasons: irrelevanceReasons && irrelevanceReasons.length ? irrelevanceReasons : null,
        sessionId: sessionId || null, timestamp: new Date().toISOString(),
      };

      // Ecriture LOCALE : best-effort, ne doit jamais faire echouer la requete
      // (notamment en environnement serverless ou le disque n'est pas persistant).
      let localOk = true;
      try {
        const log = loadJson(FEEDBACK_LOG_PATH, []);
        log.push(entry);
        saveJsonAtomic(FEEDBACK_LOG_PATH, log);
      } catch (e) { localOk = false; }

      // Ecriture SUPABASE : nouvelle table `feedback` uniquement, jamais `movies`.
      // No-op silencieux si DATABASE_URL n'est pas definie (comportement local inchange).
      saveFeedbackToSupabase(entry).then(supabaseResult => {
        res.json({ ok: true, savedLocally: localOk, savedToSupabase: supabaseResult.ok, supabaseError: supabaseResult.ok ? null : supabaseResult.error });
      });
    } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => console.log(`Prototype V3 sur http://localhost:${PORT}`));
}

module.exports = { createApp, shortSynopsis, toClientShape, ensureLoaded, handleSearch };
