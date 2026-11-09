# Changelog

## 2.0.0

### Ajouté
- **Navigation** : Aperçu, Finances, Analyses, Tâches, Assistant, Paramètres. Barre latérale (ordinateur), barre du bas avec bouton « + » (mobile). Thèmes clair/sombre, jetons de design (`src/index.css`).
- **Aperçu** : solde, disponible, dépense conseillée par jour, revenus/dépenses/épargne, catégories, budgets, alertes, échéances, tâches du jour, dernières dépenses.
- **Revenus** : 14 types (alternance, salaire, freelance, prime, CAF, APL, prime d'activité, bourse, remboursements…), statuts (attendu → terminé), brut → net → reçu, aides estimées/confirmées, versement à un tiers. Seul l'argent *reçu* compte comme disponible.
- **Dépenses** : formulaire progressif (montant, catégorie, précision, établissement, plateforme de livraison, trajet, ticket mixte), 18 catégories + sous-catégories, annuaire d'établissements français (sans McDonald's / KFC / Burger King suggérés), statut halal séparé et vérifiable (source obligatoire), établissements et sous-catégories personnalisés.
- **Abonnements** (pro, personnel/télécoms, transport) : coût mensuel/annuel, renouvellements, doublons, résiliation, « Payé » → vraie dépense.
- **Budgets** par catégorie, charges fixes, objectifs d'épargne et réserves, prévision sur 6 mois (uniquement à partir de ce qui est saisi).
- **Analyses** : jour/semaine/mois/année, comparaison avec la période précédente, exploration catégorie → sous-catégorie → établissement/plateforme jusqu'aux transactions, dépenses inhabituelles (règles documentées).
- **Tâches** : ma journée, semaine, calendrier, à venir, en retard, terminées, récurrence, priorités, saisie rapide en français (« demain 14h30 ! ~30min »), catégories, détection des journées chargées.
- **Alertes** déterministes (info / attention / critique), dédoublonnées, fermables, préférences. **Assistant** : conseils sans IA + conversation via un fournisseur configuré côté serveur ; propositions de tâches à valider.
- Export CSV : abonnements et tâches (en plus des dépenses et revenus). Suppression de données par périmètre (finances, tâches, assistant, tout).
- `wrangler.jsonc` (absent de l'archive V1), tests (105), `docs/`, script de retour arrière.

### Modifié
- Catégories : 10 → 18 (les 10 identifiants V1 sont conservés ; « Autre » devient « Autre (ancien) »). Test V1 mis à jour : changement volontaire.
- « Appliquer les revenus habituels » enregistre désormais des revenus **attendus** par défaut (choix proposé dans l'interface). `{status:"confirmed"}` reproduit le comportement V1.
- Les totaux « Revenus » = argent reçu. Les revenus V1 (sans détail) restent « confirmés, versés à l'utilisateur » : totaux V1 inchangés.
- La page « Analyse » V1 est remplacée par « Analyses » ; « Historique » devient l'onglet « Dépenses » de Finances (anciennes URL redirigées). L'assistant de saisie en 5 étapes est remplacé par le formulaire progressif (mêmes données : date, lieu, catégories multiples, paiement, description).
- Anti-CSRF renforcé (`Origin: null` refusé, `Sec-Fetch-Site`), CSP `default-src 'none'` côté API.

### Corrigé / sécurité
- **PWA** : le service worker V1 mettait en cache les réponses `/api/*` sans distinguer les utilisateurs ; la V2 ne met plus aucune donnée en cache et purge l'ancien cache. Les données en mémoire sont vidées à la déconnexion / expiration de session.
- Export CSV : neutralisation des formules (`= + - @`) dans les cellules texte.

### Base de données
Migrations additives `0003` → `0005` ; V1 `0001`/`0002` inchangées. Retour arrière : `docs/rollback-v2.sql`.
Déploiement V2
