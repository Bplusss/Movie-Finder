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

  // Traduction lisible des variantes de pays extraites par le parseur
  // (voir COUNTRY_WORDS dans structured-query-parser.js). Chaque cle
  // "canonique" ci-dessous correspond a UNE des variantes possibles
  // generees pour ce pays -- on affiche juste un drapeau/libelle une fois
  // qu'on detecte n'importe laquelle des variantes de ce groupe.
  const COUNTRY_DISPLAY = [
    { flag: "🇫🇷", label: "Film français", variants: ["france"] },
    { flag: "🇺🇸", label: "Film américain", variants: ["etats-unis", "united states", "usa", "amerique"] },
    { flag: "🇬🇧", label: "Film britannique", variants: ["royaume-uni", "united kingdom", "grande-bretagne", "angleterre"] },
    { flag: "🇩🇪", label: "Film allemand", variants: ["allemagne", "germany"] },
    { flag: "🇮🇹", label: "Film italien", variants: ["italie", "italy"] },
    { flag: "🇯🇵", label: "Film japonais", variants: ["japon", "japan"] },
    { flag: "🇪🇸", label: "Film espagnol", variants: ["espagne", "spain"] },
    { flag: "🇰🇷", label: "Film coréen", variants: ["coree", "korea"] },
    { flag: "🇨🇳", label: "Film chinois", variants: ["chine", "china"] },
    { flag: "🇨🇦", label: "Film canadien", variants: ["canada"] },
  ];

  function countryChipsFor(countryVariants) {
    if (!countryVariants || !countryVariants.length) return [];
    const chips = [];
    for (const c of COUNTRY_DISPLAY) {
      if (c.variants.some(v => countryVariants.includes(v))) chips.push(`${c.flag} ${c.label}`);
    }
    return chips;
  }

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
    chips.push(...countryChipsFor(f.countryVariants));
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
    const countryChips = countryChipsFor(f.countryVariants);
    if (countryChips.length) parts.push(`${countryChips.join(", ")}.`);
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
