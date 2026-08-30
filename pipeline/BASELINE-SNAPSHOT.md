# BASELINE FIGÉE — architecture v3, retrieval → ranking

Ce fichier documente l'état exact du moteur au moment où le benchmark de
référence (60 requêtes) a été construit. Toute comparaison "avant/après"
future doit se faire contre CET état précis, pas contre une impression.

## Fichiers concernés et leur rôle dans l'architecture

| Fichier | Rôle |
|---|---|
| `pipeline/lib/structured-query-parser.js` | Extraction acteur/réalisateur/année/durée/genre → filtres durs |
| `pipeline/lib/hard-filter-retrieval.js` | Application des filtres durs (jamais un score) |
| `pipeline/lib/entity-gazetteer.js` | Dictionnaire fermé acteurs/réalisateurs, construit depuis les données réelles |
| `pipeline/lib/lexical-rarity.js` | Score lexical pondéré IDF — **formule identifiée comme source du bug de couverture** |
| `pipeline/lib/movie-search-v3.js` | Orchestration retrieval → ranking, classification de famille, poids fixes |

## Paramètres figés (valeurs exactes au moment du gel)

```js
FAMILY_WEIGHTS = {
  ambiance:          { lexical: 0.35, embedding: 0.65, embeddingField: "intro" },
  subject_narrative: { lexical: 0.65, embedding: 0.35, embeddingField: "synopsis" },
}
```

```js
AMBIANCE_LEXICON = [
  "peur", "effrayant", "effraie", "terrifiant", "angoiss", "oppress", "tendu", "tension",
  "pression", "stress", "malaise", "sombre", "glacant", "inquiet",
  "feel-good", "feelgood", "feel good", "leger", "joyeux", "triste", "melancolique",
  "chaleureux", "reconfortant", "mysterieux",
]
```

Formule de score lexical (`lexical-rarity.js`, `scoreWithIdf`) :
```js
score = Math.round((achievedIdf / maxPossibleIdf) * 100)
```
**Défaut identifié** : ce ratio mesure la part d'IDF captée, pas la couverture du concept — un seul mot rare matché peut produire un score proche de 100 même si le reste de la requête est absent du document.

## Comportement mécanique déjà validé sur cette baseline (ne pas re-tester)

- Filtre acteur/réalisateur/année/durée/genre : 100% de conformité mécanique confirmée sur données réelles (Russell Crowe, Clint Eastwood)
- Un film hors-filtre ne peut jamais réapparaître dans un pool filtré, même avec un score sémantique parfait (testé et prouvé)

## Ce que ce gel NE couvre PAS encore

- Qualité du ranking à l'intérieur d'un pool (sujet de l'étude en cours)
- Le lexique d'ambiance n'est pas garanti exhaustif
