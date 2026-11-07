# Tests

```bash
npm run typecheck
npm test
npm run build
npm run test:api     # serveur `npm run dev` lancé dans un autre terminal
```

Les tests utilisent la **vraie** application Hono et les **vraies** migrations SQL sur SQLite (`node:sqlite`, Node ≥ 22.13) via `tests/helpers/d1.ts`.

| Fichier | Contenu |
|---|---|
| `tests/migration.test.ts` | Migration V1 → V2, intégrité, contraintes, retour arrière |
| `tests/api.core.test.ts` | Authentification, CSRF, régression V1, dépenses et revenus V2, isolation, exports, suppression par périmètre |
| `tests/api.modules.test.ts` | Abonnements, budgets, charges fixes, objectifs, tâches, analyses, alertes, assistant IA (fournisseur simulé par `fetch` factice), isolation |
| `tests/shared.unit.test.ts` | Règles pures : budget, récurrence, revenus, tâches, doublons, CSV |
| `tests/finance.test.ts` | Formules V1 (10 → 18 catégories : changement volontaire) |

Non couvert par des tests automatiques : les écrans React (vérifiés manuellement sur navigateur, mobile 390 px et bureau 1280 px, thèmes clair et sombre) et les appels réels aux fournisseurs d'IA (aucune clé disponible).
