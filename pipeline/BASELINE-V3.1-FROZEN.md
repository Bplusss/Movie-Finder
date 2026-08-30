# BASELINE V3.1 — état gelé avant corrections ciblées

Empreinte de `pipeline/lib/movie-search-v3.js` juste avant modification :
```
756359a4db097a27be1958de8405ac91
```

## Deux anomalies diagnostiquées via les feedbacks réels (636 entrées)

### 1. "Christopher Nolan" absent du champ réalisateur — DONNÉE, pas un bug de code

Confirmé via `pipeline/diagnose-gazetteer.js` : le film *Le Prestige* a `directors: []`
dans `semantic-enrichment-1018-final.json`. Le mécanisme de filtre (gazetteer +
parseur + hard-filter-retrieval) fonctionne correctement — il n'y a simplement
rien à trouver, la donnée elle-même est vide.

### 2. "qui fait rire" mal classé — vrai bug de code, corrigé ci-dessous

`classifyFamily()` dans `movie-search-v3.js` ne reconnaît "qui fait rire" ni
via `AMBIANCE_LEXICON`, ni via l'ancien moteur (`semantic-search-engine.js`
ne détecte que "drôle"/"drole", pas "rire"). La requête tombe donc dans la
famille par défaut `subject_narrative`, sans aucun signal d'humour — d'où
les résultats d'horreur observés au lieu de comédies.
