# Movie Finder — Sources de données

Ce document doit être vérifié et complété par un juriste avant toute mise en
ligne commerciale. Il documente l'état des lieux au moment du prototype.

**Distinction importante dans tout ce document** :
- 🟢 **Vérifié** = fait stable, documenté publiquement depuis longtemps par la
  source elle-même, ou testé en direct pendant le développement.
- 🟡 **À vérifier** = ma meilleure connaissance au moment de l'écriture, sans
  accès web en direct pour la reconfirmer aujourd'hui — à relire toi-même
  avant tout engagement commercial.

## 0. Historique des choix (pour comprendre le contexte)

Trois approches ont été essayées dans l'ordre :
1. **Endpoint SPARQL public de Wikidata** (`query.wikidata.org`) — abandonné :
   trop instable pour un import de masse (erreurs 504 répétées, y compris sur
   des requêtes très simples).
2. **TMDB** — abandonné : leur API gratuite est réservée à un usage non
   commercial, incompatible avec un site financé par la publicité.
3. **Architecture retenue** : Wikidata comme référentiel canonique (via ses
   API officielles de recherche + de récupération d'entités, PAS le endpoint
   SPARQL), enrichi par DBpedia pour le synopsis. Voir §1 et §2.

## 1. Wikidata — référentiel canonique

- **🟢 Méthode d'import (testée en direct)** : PAS de SPARQL, PAS de dump complet.
  - Étape 1 — découverte : `action=query&list=search&srsearch=haswbstatement:P31=Q11424`
    sur `www.wikidata.org/w/api.php`, paginé par lots de 500 via le jeton
    `continue`. Testé : réponse rapide, 348 800 films disponibles.
  - Étape 2 — détail : `action=wbgetentities&ids=Q1|Q2|...` (jusqu'à 50
    identifiants par appel). Testé : réponse rapide, structure JSON confirmée
    (labels, descriptions, claims, sitelinks).
  - Étape 3 — résolution des libellés référencés : les champs comme
    réalisateur/genre/pays/acteur sont eux-mêmes des identifiants Wikidata
    (pas des noms en clair) — un second passage `wbgetentities`, ciblé
    uniquement sur l'ensemble dédupliqué de ces identifiants rencontrés,
    résout leurs noms. Aucun dump requis, juste des lots supplémentaires de 50.
- **🟢 Données obtenues** : titre (multi-langue), date de sortie, durée,
  pays, genre(s), réalisateur(s), acteurs principaux, identifiant IMDb
  (P345), liens Wikipédia (sitelinks). **Pas de synopsis** (Wikidata ne
  stocke pas de texte narratif — d'où le besoin de DBpedia, voir §2).
- **🟢 Licence** : CC0 (domaine public), politique stable et documentée
  depuis la création du projet.
- **Usage commercial** : ✅ autorisé sans restriction.
- **Attribution** : non requise légalement (bonne pratique de la mentionner).
- **Modification/enrichissement** : ✅ libre.
- **Stockage local d'une copie** : ✅ autorisé.
- **Redistribution** : ✅ autorisée.
- **🟡 À vérifier** : les limites de débit (rate limits) exactes de ces API
  MediaWiki au moment de l'usage réel à grande échelle — elles sont
  généralement généreuses pour un usage raisonnable avec pauses, mais leur
  valeur précise actuelle n'a pas été confirmée en direct.

## 2. DBpedia — enrichissement (synopsis uniquement pour l'instant)

- **Rôle** : n'enrichit QUE des films déjà créés par l'import Wikidata
  (retrouvés via leur `wikidata_id` / `owl:sameAs`). Ne crée jamais de
  nouveau film. Voir la règle de déduplication en §4.
- **🟢 Licence** : CC BY-SA 3.0 (héritée de Wikipédia).
- **Usage commercial** : ✅ autorisé, à condition de respecter attribution
  et partage à l'identique (voir ci-dessous).
- **Attribution** : **obligatoire**, sur toute page affichant du contenu
  DBpedia (typiquement : mention "Synopsis : Wikipédia/DBpedia, CC BY-SA 3.0").
- **Partage à l'identique (SA)** : s'applique au **texte** repris tel quel
  (le synopsis). Les faits bruts (une durée, un nom) ne sont généralement pas
  eux-mêmes protégés par le droit d'auteur, mais le texte du synopsis l'est.
  Deux options compatibles avec un usage commercial :
  (a) afficher le synopsis brut avec attribution complète et accepter que ce
      texte précis reste réutilisable sous la même licence par des tiers ; ou
  (b) le faire reformuler (édition humaine ou passage par
      `pipeline/enrich-llm.js`) pour en faire un texte nouveau, ce que ce
      projet privilégie par prudence.
- **Modification/enrichissement** : ✅ libre sur les faits ; le texte "brut"
  reste sous CC BY-SA tant qu'il n'est pas reformulé.
- **Stockage local d'une copie** : ✅ autorisé.
- **Redistribution** : ✅ oui, sous la même licence pour le texte réutilisé
  tel quel.
- **🟡 À vérifier (spécifique UE)** : le droit *sui generis* des bases de
  données (régime européen distinct du droit d'auteur, protégeant une
  extraction "substantielle" d'une base de données) — DBpedia accorde une
  licence qui couvre normalement ce point pour un usage conforme à ses
  conditions, mais un avis juridique local est recommandé si le site cible
  spécifiquement le marché européen.
- **Doc officielle** : `dbpedia.org` (section Databus / Licensing) — à
  relire pour confirmer que les fichiers utilisés existent toujours sous les
  mêmes noms/URLs au moment de l'implémentation (leur organisation évolue
  occasionnellement).

## 3. Traçabilité par champ (provenance)

Chaque film conserve, en plus de la donnée elle-même, sa source exacte.
Exemple de ce que stocke Movie Finder pour un film :

```
title            = "Amélie"          title_source    = "wikidata"
runtime_minutes  = 122                runtime_source  = "wikidata"
synopsis         = "Une jeune..."     synopsis_source = "dbpedia"
```

Objectif : pouvoir remplacer ou auditer une source précise (ex. si DBpedia
change de conditions demain) sans toucher au reste du catalogue. Voir
`schema.sql` pour les colonnes `*_source` correspondantes.

## 4. Règle de déduplication Wikidata ↔ DBpedia

Le `wikidata_id` est la clé d'identité canonique d'un film dans Movie Finder.

1. Un film est **créé** uniquement par l'import Wikidata.
2. DBpedia **enrichit** une ligne existante en la retrouvant via
   `owl:sameAs` vers l'entité Wikidata correspondante — DBpedia ne crée
   jamais de nouveau film dans notre base.
3. À défaut de lien `owl:sameAs` exploitable, un repli par titre + année
   normalisés est tenté, mais marqué "à valider manuellement" plutôt que
   fusionné silencieusement (`pipeline/lib/dedupe.js`).
4. Chaque champ issu de DBpedia est stocké dans une colonne à part
   (`synopsis` + `synopsis_source`), jamais mélangé sans traçabilité aux
   champs Wikidata — voir §3.

## 5. Identifiants externes conservés

Pour chaque film, lorsqu'ils existent :
- `wikidata_id` (ex. `Q186531`) — clé canonique interne
- `dbpedia_uri` (ex. `http://dbpedia.org/resource/Amélie`)
- `imdb_id` (récupéré via la propriété Wikidata P345, ex. `tt0211915`)
- autres identifiants disponibles, stockés dans `external_ids` (jsonb)

## 6. Affiches / images (posters, backdrops)

- **Statut actuel du prototype** : AUCUNE affiche réelle n'est utilisée.
  Les cartes utilisent des blocs de couleur générés (placeholders).
- Le modèle de données prévoit des champs `poster_url` / `backdrop_url` pour
  brancher plus tard une source d'images dont la licence autorise
  explicitement l'usage commercial — à négocier avant toute mise en production.
- Les affiches de films sont en général protégées par le droit d'auteur du
  studio de distribution ; ne pas les scraper depuis des sites tiers.

## 7. Disponibilité sur les plateformes de streaming

- **Statut actuel** : données 100% simulées, affichées avec la mention
  explicite "Disponibilité simulée — prototype".
- En production, ces informations nécessitent une source spécialisée sous
  licence (ex. JustWatch API, Reelgood, ou accords directs avec les
  plateformes) — ni Wikidata ni DBpedia ne couvrent la disponibilité en
  temps réel.

## 8. Résumé

| Source | Rôle | Licence | Usage commercial | Attribution | Statut |
|---|---|---|---|---|---|
| Wikidata | Référentiel canonique | CC0 | ✅ sans restriction | Recommandée | 🟢 Confirmé |
| DBpedia | Enrichissement (synopsis) | CC BY-SA 3.0 | ✅ avec attribution + SA sur le texte | Obligatoire | 🟡 Licence stable et connue, détails d'implémentation à reconfirmer |
| TMDB | Abandonné | — | ❌ gratuit = non-commercial | — | Écarté |
| Affiches de films | Non utilisé | Copyright studio | ❌ sans accord | — | À NÉGOCIER |
| Disponibilité streaming | Non utilisé | Variable | Dépend du fournisseur | Dépend | À NÉGOCIER |
