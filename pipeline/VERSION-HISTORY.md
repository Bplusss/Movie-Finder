# HISTORIQUE DES VERSIONS — Movie Finder V3

Chaque ligne est une version figée. Toute modification future doit être
ajoutée ici, jamais réécrite par-dessus une version existante.

## V3.0 — Architecture retrieval → ranking initiale
- **Changements** : filtres durs (acteur/réalisateur/année/durée/genre) puis
  classement sémantique par famille (ambiance/sujet-narratif), poids fixes.
- **Tests** : `offline-test-movie-search-v3.js` (cas critique Eastwood+vengeance,
  classification de famille).
- **Justification** : étude comparative A/B/C/D/E, fusion avec signal
  indépendant retenue.

## V3.1 — Baseline gelée (voir `BASELINE-V3.1-FROZEN.md`)
- **Changements** : aucun — gel de référence avant correctifs.
- **Empreinte `movie-search-v3.js`** : `756359a4db097a27be1958de8405ac91`

## V3.2 — Correctif "qui fait rire"
- **Changements** : `AMBIANCE_LEXICON` étendu (rire, fait rire, comique,
  hilarant, drole, amusant) — une seule ligne.
- **Empreinte `movie-search-v3.js`** : `742f972b8836c8586830a13ea1cde243`
- **Tests** : nouveau cas dans `offline-test-movie-search-v3.js` — reproduit
  exactement le bug réel ("un film de moins de 100 minutes qui fait rire"
  classée `subject_narrative` avant, `ambiance` après).
- **Feedback ayant motivé la correction** : requête réelle observée dans
  `feedback-log.json`, résultats d'horreur au lieu de comédies.

## Format pour toute future entrée

```
## Vx.y — <titre court>
- Changements : <diff précis, fichier par fichier>
- Empreinte <fichier modifié> : <md5 avant> → <md5 après>
- Tests : <fichiers de test concernés, résultat>
- Feedback ayant motivé la correction : <requête(s)/motif observé>
- Régression vérifiée : <résultat de test-nonregression.js>
```
