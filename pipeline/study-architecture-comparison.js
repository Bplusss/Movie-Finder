// pipeline/study-architecture-comparison.js
// node pipeline/study-architecture-comparison.js
//
// Comparaison EXPERIMENTALE HORS-LIGNE de 3 strategies de fusion, sur un
// catalogue synthetique qui reproduit EXACTEMENT le motif du bug "espace" :
// un film hors-sujet qui matche un seul mot rare (score lexical proche de
// 100), contre de vrais films pertinents qui matchent plusieurs mots avec un
// score individuellement plus bas. Aucun reseau, aucune dependance aux
// vraies donnees — but : mesurer la ROBUSTESSE de chaque architecture face a
// ce motif precis, pas choisir une formule au hasard.
"use strict";
const { buildDocumentFrequency, scoreWithIdf } = require("./lib/lexical-rarity");
const { tokenize } = require("./lib/synopsis-search");

const CATALOG = [
  { id: "Q1", title: "127 Heures (piege : hors-sujet, partage 1 mot rare hors-contexte)",
    text: "Un homme reste seul dans le vide de son appartement, un grand espace vide ou resonne le silence, coince pendant des jours." },
  { id: "Q2", title: "Solaris (vrai film d'espace)",
    text: "Un psychologue est envoye dans une station spatiale en orbite pour enqueter sur des phenomenes etranges affectant l'equipage." },
  { id: "Q3", title: "Star Trek (vrai film d'espace)",
    text: "Un equipage explore l'espace a bord d'un vaisseau spatial, voyageant entre les etoiles et les planetes lointaines." },
  { id: "Q4", title: "Avatar (vrai film d'espace)",
    text: "Des humains voyagent dans l'espace jusqu'a une lointaine planete extraterrestre pour exploiter ses ressources naturelles." },
  { id: "Q5", title: "Comedie Romantique (bruit neutre)",
    text: "Deux amis d'enfance tombent amoureux lors d'un mariage dans une petite ville de province." },
];
const QUERY = "un film qui se passe dans l'espace";
const RELEVANT = new Set(["Q2", "Q3", "Q4"]);

function precisionAt3(rankedIds) {
  const top3 = rankedIds.slice(0, 3);
  return top3.filter(id => RELEVANT.has(id)).length / 3;
}
function mrr(rankedIds) {
  for (let i = 0; i < rankedIds.length; i++) if (RELEVANT.has(rankedIds[i])) return 1 / (i + 1);
  return 0;
}
function rankOfTrap(rankedIds) { return rankedIds.indexOf("Q1") + 1; }

function strategyB(catalog, queryTokens, df, N) {
  return catalog
    .map(m => ({ id: m.id, score: scoreWithIdf(queryTokens, m.text, df, N).score }))
    .sort((a, b) => b.score - a.score)
    .map(r => r.id);
}

function strategyC(catalog, queryTokens, df, N) {
  const scored = catalog.map(m => ({ id: m.id, score: scoreWithIdf(queryTokens, m.text, df, N).score }));
  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const k = 60;
  return byScore.map((r, i) => ({ id: r.id, rrf: 1 / (k + i + 1) })).sort((a, b) => b.rrf - a.rrf).map(r => r.id);
}

function strategyD(catalog, queryTokens, df, N) {
  return catalog
    .map(m => {
      const r = scoreWithIdf(queryTokens, m.text, df, N);
      const coverage = r.matchedTerms.length / queryTokens.length;
      const combined = r.score * 0.4 + coverage * 100 * 0.6;
      return { id: m.id, combined };
    })
    .sort((a, b) => b.combined - a.combined)
    .map(r => r.id);
}

// ============ E. FUSION AVEC UN SIGNAL INDEPENDANT (embedding simule) ============
// Simule ce qu'un embedding REEL devrait faire : capter le CONTEXTE, pas
// juste la presence du mot. Q1 parle d'un appartement vide (mot "espace"
// hors-sujet) -> similarite BASSE attendue. Q2/Q3/Q4 parlent reellement
// d'espace -> similarite HAUTE attendue. Valeurs plausibles, pas mesurees
// (aucun reseau ici), pour tester si la FUSION avec un signal independant,
// et non une reformulation du lexical seul, resout le probleme.
const MOCK_EMBEDDING_SIMILARITY = { Q1: 15, Q2: 78, Q3: 82, Q4: 75, Q5: 5 };
function strategyE(catalog, queryTokens, df, N) {
  return catalog
    .map(m => {
      const lex = scoreWithIdf(queryTokens, m.text, df, N).score;
      const emb = MOCK_EMBEDDING_SIMILARITY[m.id];
      return { id: m.id, combined: lex * 0.35 + emb * 0.65 };
    })
    .sort((a, b) => b.combined - a.combined)
    .map(r => r.id);
}

function run() {
  const queryTokens = tokenize(QUERY).filter(t => t.length > 2 && !["une", "un", "qui", "dans", "passe"].includes(t));
  const df = buildDocumentFrequency(CATALOG.map(m => m.text));
  const N = CATALOG.length;

  console.log(`Requete : "${QUERY}"`);
  console.log(`Mots-cles apres nettoyage : [${queryTokens.join(", ")}]`);
  console.log(`Ground truth (vrais films d'espace) : Q2, Q3, Q4. Piege (hors-sujet) : Q1.\n`);

  const strategies = { B_actuelle_score_brut: strategyB, C_retrieval_rang_RRF: strategyC, D_rerank_couverture: strategyD, E_fusion_embedding_independant: strategyE };

  for (const name in strategies) {
    const ranked = strategies[name](CATALOG, queryTokens, df, N);
    console.log(`${"=".repeat(60)}`);
    console.log(`Strategie ${name}`);
    console.log(`${"=".repeat(60)}`);
    ranked.forEach((id, i) => {
      const movie = CATALOG.find(m => m.id === id);
      console.log(`  #${i + 1} ${movie.title}`);
    });
    console.log(`  Precision@3 = ${precisionAt3(ranked).toFixed(2)}  |  MRR = ${mrr(ranked).toFixed(2)}  |  Position du piege Q1 = ${rankOfTrap(ranked)} (plus haut = pire)\n`);
  }
}

if (require.main === module) run();
module.exports = { run, strategyB, strategyC, strategyD, strategyE, CATALOG, RELEVANT };
