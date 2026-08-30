// pipeline/lib/text-cleaner.js
// Logique PURE (aucun reseau ici) : nettoie un texte source avant de le
// transmettre au modele, pour les niveaux de fallback 2 et 3. N'invente rien,
// ne reformule rien — retire uniquement le bruit structurel evident.
"use strict";

function isNoisyLine(line) {
  const t = line.trim();
  if (!t) return true;
  if (t.length < 3) return true;
  if (/^[-*•]\s/.test(t)) return true; // ligne de liste a puces
  if (/^\d+[.)]\s/.test(t)) return true; // ligne de liste numerotee
  if (/[{}[\]]/.test(t)) return true; // ressemble a un fragment JSON/structure de donnees
  if (t === t.toUpperCase() && /^[A-ZÀ-Ü0-9 '\-:]{4,}$/.test(t)) return true; // ligne tout en majuscules = probable titre/label
  return false;
}

/** Retire les lignes bruitees, aplati en un seul paragraphe. */
function cleanText(text) {
  if (!text) return "";
  return text.split("\n").filter(l => !isNoisyLine(l)).join(" ").replace(/\s+/g, " ").trim();
}

/** Tronque proprement a une limite de longueur, en coupant sur une fin de phrase si possible. */
function truncateAtSentence(text, maxLength) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastPeriod = cut.lastIndexOf(". ");
  if (lastPeriod > maxLength * 0.4) return cut.slice(0, lastPeriod + 1).trim();
  return cut.trim();
}

module.exports = { isNoisyLine, cleanText, truncateAtSentence };
