# Migration V1 → V2

## Principe
Les migrations `0003` → `0005` sont **additives** : nouvelles colonnes (valeurs par défaut ou NULL), nouvelles tables, 8 catégories ajoutées. Aucune table V1 n'est reconstruite, aucune donnée supprimée ou réécrite.
Un revenu V1 n'a pas de ligne `income_details` : il est lu comme « confirmé, versé à l'utilisateur » (donc compté comme argent reçu, exactement comme en V1).

## Procédure sûre (base de production)
1. Exportez vos données depuis Paramètres → Données (CSV) **et** sauvegardez la base :
   `npx wrangler d1 export o-budget --remote --output=sauvegarde-v1.sql`
2. Notez quelques totaux de référence (revenus, dépenses, épargne d'un ou deux mois).
3. `npm run db:migrate:remote`
4. `npx wrangler d1 execute o-budget --remote --file=docs/integrity-checks.sql` — chaque requête doit renvoyer 0 ligne ; `PRAGMA foreign_key_check` aussi.
5. Comparez les totaux de l'étape 2 dans l'application.
6. Déployez le code V2.

## Scénarios testés (`tests/migration.test.ts`, vraies migrations sur SQLite)
- Données V1 identiques après migration (utilisateurs, mois, revenus, épargne, dépenses, paramètres).
- Valeurs par défaut / NULL pour les nouvelles colonnes ; 18 catégories dont les 10 d'origine inchangées.
- Contrôles d'intégrité propres ; une anomalie injectée est bien détectée.
- Contraintes : halal « vérifié » sans source refusé ; clé étrangère croisant deux utilisateurs refusée.
- Retour arrière : voir ci-dessous.

## Retour arrière
`docs/rollback-v2.sql` (lisez son en-tête). Il **conserve** tous les montants de dépenses et de revenus reçus, **fusionne** les 8 catégories V2 dans « Autre (ancien) », et **supprime** les données propres à la V2 (tâches, abonnements, budgets, objectifs, statuts de revenus…) ainsi que les revenus V2 non encaissés. Testé sur une base migrée et enrichie (`tests/migration.test.ts`). Sauvegardez avant.
