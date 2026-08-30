// pipeline/lib/wikipedia-api.js
// Utilise UNIQUEMENT l'API officielle MediaWiki de Wikipédia anglais
// (en.wikipedia.org/w/api.php), en ciblant un article à la fois par son
// titre exact (wikipedia_title_en, déjà connu via Wikidata). Aucun dump,
// aucun DBpedia, aucun TMDB/IMDb.
"use strict";

const API_URL = "https://en.wikipedia.org/w/api.php";
const HEADERS = { "User-Agent": "MovieFinderPOC/1.0 (prototype de recherche de films; contact: à-completer@example.com)" };

function makeHttpError(status, resp) {
  const err = new Error(`Wikipedia HTTP ${status}`);
  err.status = status;
  const retryAfter = resp.headers && resp.headers.get ? resp.headers.get("retry-after") : null;
  if (retryAfter) err.retryAfterMs = parseInt(retryAfter, 10) * 1000;
  return err;
}

/** Appel réseau brut : récupère l'introduction complète (avant le sommaire) d'un article. */
async function fetchExtractRaw(title) {
  const params = new URLSearchParams({
    action: "query", format: "json",
    prop: "extracts", exintro: "1", explaintext: "1", redirects: "1",
    titles: title,
  });
  const resp = await fetch(`${API_URL}?${params}`, { headers: HEADERS });
  if (!resp.ok) throw makeHttpError(resp.status, resp);
  return resp.json();
}

/**
 * Parse la réponse JSON de l'API MediaWiki (pure, testable hors-ligne).
 * Renvoie { found, wikipedia_url, intro_text_full } — found=false si
 * l'article n'existe pas (jamais confondu avec une erreur réseau, gérée à
 * un autre niveau).
 */
function parseExtractResponse(json, title) {
  const pages = json.query && json.query.pages;
  if (!pages) return { found: false, wikipedia_url: null, intro_text_full: null };
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) {
    return { found: false, wikipedia_url: null, intro_text_full: null };
  }
  const finalTitle = page.title || title;
  const wikipedia_url = `https://en.wikipedia.org/wiki/${encodeURIComponent(finalTitle.replace(/ /g, "_"))}`;
  const extract = page.extract && page.extract.trim() ? page.extract.trim() : null;
  return { found: true, wikipedia_url, intro_text_full: extract };
}

/**
 * Sélectionne les premiers paragraphes jusqu'à atteindre une longueur
 * minimale raisonnable (le premier paragraphe seul est parfois trop court,
 * ex. une simple phrase de désambiguïsation).
 */
function selectIntroParagraphs(fullText, minLength = 200) {
  if (!fullText) return null;
  const paragraphs = fullText.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  let result = paragraphs[0];
  let i = 1;
  while (result.length < minLength && i < paragraphs.length) {
    result += "\n\n" + paragraphs[i];
    i++;
  }
  return result;
}

async function fetchIntro(title) {
  const json = await fetchExtractRaw(title);
  const parsed = parseExtractResponse(json, title);
  if (!parsed.found) return { found: false, wikipedia_url: null, intro_text: null };
  const intro_text = selectIntroParagraphs(parsed.intro_text_full);
  return { found: true, wikipedia_url: parsed.wikipedia_url, intro_text };
}

/** Récupère le texte brut COMPLET (intro + toutes les sections) d'un article, dans la langue donnée. */
async function fetchFullExtractRaw(title, lang = "en") {
  const params = new URLSearchParams({
    action: "query", format: "json",
    prop: "extracts", explaintext: "1", redirects: "1",
    titles: title,
  });
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;
  const resp = await fetch(url, { headers: HEADERS });
  if (!resp.ok) throw makeHttpError(resp.status, resp);
  return resp.json();
}

module.exports = { fetchExtractRaw, parseExtractResponse, selectIntroParagraphs, fetchIntro, fetchFullExtractRaw };
