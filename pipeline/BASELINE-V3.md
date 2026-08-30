# BASELINE V3 — OFFICIELLE ET FIGÉE

## Statut : FIGÉE

À partir de maintenant, toute modification future du moteur de recherche doit
être comparée à cet état précis. Aucune modification de `movie-search-v3.js`
ni de la logique principale de recherche n'a eu lieu depuis ce gel.

## Fichiers constituant la baseline (non modifiés depuis leur validation)

| Fichier | Rôle |
|---|---|
| `pipeline/lib/structured-query-parser.js` | Extraction acteur/réalisateur/année/durée/genre → filtres durs |
| `pipeline/lib/hard-filter-retrieval.js` | Application des filtres durs (jamais un score) |
| `pipeline/lib/entity-gazetteer.js` | Dictionnaire fermé acteurs/réalisateurs, construit depuis les données réelles |
| `pipeline/lib/lexical-rarity.js` | Score lexical pondéré IDF (retrieval, pas juge final) |
| `pipeline/lib/movie-search-v3.js` | Orchestration retrieval → ranking, classification de famille, poids fixes |

## Résultats `benchmark:60` (référence)

| Catégorie | Conformité mécanique | Ranking |
|---|---|---|
| STRUCTURED | 9/9 — 100% | — |
| GENRES | 99/99 — 100% | — |
| SUBJECTS | 100/100 — 100% conformité | P@5=0.53, P@10=0.47, MRR=0.72, NDCG@10=0.77 |
| NARRATIVE | 100/100 — 100% conformité | P@5=0.40, P@10=0.40, MRR=1.00, NDCG@10=0.68 |
| AMBIANCE | 100/100 — 100% | — |
| HYBRID | 44/44 — 100% | — |
| **Faux positifs structurels** | **0** | |

Le filtre réalisateur (Clint Eastwood) confirmé cohérent avec le comptage
direct des données ; les contraintes année/durée s'intersectent correctement.

## Expérimentation `experiment:embedding` — REJETÉE

Résultat rapporté : P@5 = P@10 = MRR = NDCG@10 = **0** sur les requêtes avec
ground truth.

**⚠️ Anomalie signalée, non corrigée** : un zéro parfait et uniforme sur les
4 métriques et toutes les requêtes ground truth est un motif inhabituel pour
un simple échec sémantique (qui donnerait normalement des résultats
mitigés). Cela évoque davantage un problème technique silencieux (cache
d'embeddings vide pour ces films précis, décalage de champ, etc.) qu'un
verdict de fond sur la valeur de l'embedding indépendant. Documenté ici tel
quel, comme demandé — **signalé, pas réinvestigué ni corrigé
automatiquement**. Si cette anomalie doit être vérifiée un jour, ce sera une
étape séparée et explicitement demandée, pas une réouverture du sujet.

**Décision actée malgré tout** : l'embedding indépendant est **rejeté** comme
remplacement ou modification du moteur principal à ce stade. La baseline V3
reste la version de référence.

## Principe pour la suite

Le moteur V3 ne doit plus être modifié sur la base d'améliorations
théoriques. Toute évolution future doit s'appuyer sur des données de
feedback réel collectées via le prototype (voir `prototype-v3.html` /
`server/prototype-v3-server.js`).
