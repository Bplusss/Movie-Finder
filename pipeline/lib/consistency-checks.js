// pipeline/lib/consistency-checks.js
// Logique PURE (aucun reseau/DB ici) : detecte des contradictions evidentes
// dans un profil semantique deja genere. NE CORRIGE JAMAIS rien — signale
// uniquement, sous forme de warnings, pour audit humain ulterieur.
"use strict";

function includesFuzzy(arr, pattern) {
  return (arr || []).some(v => pattern.test(v));
}

/**
 * Renvoie une liste de warnings texte pour un profil donne. Tableau vide si
 * aucune contradiction evidente detectee. Ne modifie jamais le profil.
 */
function checkConsistency(profile) {
  const warnings = [];

  // Le cas reel trouve lors de l'audit des 20 films (documentaire "Crack")
  if (profile.family_friendly !== null && profile.family_friendly <= 3 && includesFuzzy(profile.good_for, /famille/i)) {
    warnings.push(`family_friendly=${profile.family_friendly} (bas) mais good_for contient une mention "famille"`);
  }

  if (profile.darkness !== null && profile.feel_good !== null && profile.darkness >= 7 && profile.feel_good >= 7) {
    warnings.push(`darkness=${profile.darkness} et feel_good=${profile.feel_good} simultanement eleves (contradiction potentielle)`);
  }

  if (profile.violence !== null && profile.family_friendly !== null && profile.violence >= 7 && profile.family_friendly >= 7) {
    warnings.push(`violence=${profile.violence} et family_friendly=${profile.family_friendly} simultanement eleves (contradiction potentielle)`);
  }

  if (profile.humor !== null && profile.humor >= 7 && profile.darkness !== null && profile.darkness >= 8) {
    warnings.push(`humor=${profile.humor} (tres eleve) et darkness=${profile.darkness} (tres eleve) simultanement — combinaison rare a verifier`);
  }

  return warnings;
}

module.exports = { checkConsistency };
