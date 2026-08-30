// pipeline/lib/wikipedia-sections.js
// Logique PURE (aucun reseau ici) : decoupe le texte brut complet d'un
// article Wikipedia (renvoye par prop=extracts&explaintext=1, SANS exintro)
// en introduction + sections, et cherche une section de type "synopsis" par
// LISTE BLANCHE stricte (jamais une devinette sur un titre de section).
"use strict";

// Liste blanche stricte : seuls ces titres (normalises) comptent comme
// "synopsis". Tout le reste (Production, Reception, Cast, Characters...)
// est automatiquement exclu car absent de cette liste.
const SYNOPSIS_TITLES_EN = ["plot", "plot summary", "synopsis", "story", "premise", "plotline"];
const SYNOPSIS_TITLES_FR = ["synopsis", "intrigue", "resume", "resume de l'intrigue", "trame", "trame narrative"];

function normalizeSectionTitle(title) {
  return (title || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // enleve les accents (pour comparer "résumé" et "resume")
    .replace(/[’']/g, "'")
    .trim();
}

/**
 * Decoupe un texte brut Wikipedia (avec des lignes "== Titre ==" comme
 * separateurs de section, tel que renvoye par explaintext=1) en introduction
 * + liste de sections {title, content}.
 */
function parseSections(fullText) {
  if (!fullText) return { intro: "", sections: [] };
  const lines = fullText.split("\n");
  const headerRe = /^(={2,6})\s*(.+?)\s*\1\s*$/;

  let intro = [];
  const sections = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(headerRe);
    if (m) {
      if (current) sections.push({ title: current.title, content: current.buffer.join("\n").trim() });
      current = { title: m[2].trim(), buffer: [] };
    } else if (current) {
      current.buffer.push(line);
    } else {
      intro.push(line);
    }
  }
  if (current) sections.push({ title: current.title, content: current.buffer.join("\n").trim() });

  return { intro: intro.join("\n").trim(), sections };
}

/** Cherche une section correspondant a la liste blanche synopsis pour la langue donnee. Renvoie null si aucune. */
function findSynopsisSection(sections, lang) {
  const whitelist = lang === "fr" ? SYNOPSIS_TITLES_FR : SYNOPSIS_TITLES_EN;
  for (const s of sections) {
    if (whitelist.includes(normalizeSectionTitle(s.title))) return s;
  }
  return null;
}

module.exports = { parseSections, findSynopsisSection, normalizeSectionTitle, SYNOPSIS_TITLES_EN, SYNOPSIS_TITLES_FR };
