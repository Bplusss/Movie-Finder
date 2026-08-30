// prototype-v3-helpers.js
// Fonctions PURES (aucun DOM ici) — traduisent les donnees brutes du moteur
// V3 en texte lisible pour un utilisateur normal. N'inventent jamais une
// intention non extraite par le moteur : si un champ est absent/vide, rien
// n'est affiche pour lui. Charge a la fois comme <script> classique dans le
// navigateur (definit les fonctions en global) et comme module Node pour les
// tests hors-ligne.
(function (root) {
  "use strict";

  const GENRE_LABELS = {
    comedy: "🎭 Comédie", thriller: "🔪 Thriller", action: "💥 Action", drama: "🎬 Drame",
    scifi: "🚀 Science-fiction", horror: "👻 Horreur", crime: "🕵️ Policier",
    adventure: "🗺️ Aventure", fantasy: "🐉 Fantastique", documentary: "📽️ Documentaire", war: "⚔️ Guerre",
  };

  const IRRELEVANCE_REASONS = [
    "Mauvais sujet", "Mauvais genre", "Mauvaise époque", "Mauvais acteur/réalisateur", "Autre",
  ];

  function formatRuntimeChip(f) {
    const chips = [];
    if (f.runtime_max != null) {
      const h = Math.floor(f.runtime_max / 60), m = f.runtime_max % 60;
      chips.push(`⏱️ moins de ${h}h${m ? m.toString().padStart(2, "0") : ""}`);
    }
    if (f.runtime_min != null) {
      const h = Math.floor(f.runtime_min / 60), m = f.runtime_min % 60;
      chips.push(`⏱️ plus de ${h}h${m ? m.toString().padStart(2, "0") : ""}`);
    }
    return chips;
  }

  function formatYearChip(f) {
    if (f.year_min == null && f.year_max == null) return null;
    if (f.year_min != null && f.year_max != null && f.year_min !== f.year_max) return `📅 ${f.year_min}–${f.year_max}`;
    if (f.year_min != null && f.year_min === f.year_max) return `📅 ${f.year_min}`;
    if (f.year_min != null) return `📅 après ${f.year_min}`;
    return `📅 avant ${f.year_max}`;
  }

  /** "J'ai compris" — UNIQUEMENT ce qui a reellement ete extrait, jamais une intention devinee. */
  function buildUnderstoodChips(data) {
    const chips = [];
    const f = data.filters || {};
    if (f.genres && f.genres.length) chips.push(f.genres.map(g => GENRE_LABELS[g] || `🎭 ${g}`).join(" "));
    if (f.actors && f.actors.length) chips.push(`👤 ${f.actors.join(", ")}`);
    if (f.directors && f.directors.length) chips.push(`🎬 réalisé par ${f.directors.join(", ")}`);
    const yearChip = formatYearChip(f);
    if (yearChip) chips.push(yearChip);
    chips.push(...formatRuntimeChip(f));
    if (data.semantic_query && data.semantic_query.trim()) chips.push(`🎯 ${data.semantic_query.trim()}`);
    return chips;
  }

  /** "Pourquoi ce film ?" — phrase lisible, jamais un score brut, jamais une justification inventee. */
  function explainWhyFriendly(result, data) {
    const parts = [];
    const f = data.filters || {};
    if (f.actors && f.actors.length) parts.push(`👤 ${f.actors.join(", ")} est présent dans le film.`);
    if (f.directors && f.directors.length) parts.push(`🎬 Réalisé par ${f.directors.join(", ")}.`);
    if (f.genres && f.genres.length) parts.push(`${f.genres.map(g => GENRE_LABELS[g] || g).join(", ")} — correspond au registre demandé.`);
    const d = result.detail || {};
    if (data.semantic_query && data.semantic_query.trim() && (d.lexical || d.embedding)) {
      parts.push(`🎯 L'histoire correspond à votre recherche de « ${data.semantic_query.trim()} ».`);
    }
    if (!parts.length) return "Correspond aux critères de votre recherche.";
    return parts.join(" ");
  }

  const api = { GENRE_LABELS, IRRELEVANCE_REASONS, buildUnderstoodChips, explainWhyFriendly, formatYearChip, formatRuntimeChip };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MovieFinderHelpers = api;
})(typeof window !== "undefined" ? window : this);
