# O-Budget 2.0

Application de finances personnelles, d'abonnements, de tâches et d'assistant, pensée mobile d'abord.
React 19 · TypeScript · Vite · Tailwind 4 · Hono sur Cloudflare Workers · D1 (SQLite).

**Contenu de la V2** : aperçu du mois (solde, disponible, dépense conseillée par jour), revenus détaillés
(attendu / confirmé, brut → net, aides), dépenses à formulaire progressif (sous-catégories, établissements, plateformes de
livraison, trajets, statut halal vérifiable), abonnements, budgets, charges fixes, objectifs d'épargne, prévision,
analyses (jour / semaine / mois / année, exploration, comparaison, dépenses inhabituelles), tâches (ma journée, semaine,
calendrier, récurrence), alertes et assistant (conseils déterministes + conversation IA facultative).
Voir [CHANGELOG.md](CHANGELOG.md).

## Démarrage local

Prérequis : Node ≥ 22.13.

```bash
npm install
cp .dev.vars.example .dev.vars       # facultatif
npm run db:migrate:local             # crée la base D1 locale (migrations 0001 → 0005)
npm run dev                          # http://localhost:5173
```

Créez votre compte sur l'écran d'inscription. Aucune donnée n'est préremplie : les revenus, dépenses et abonnements
n'existent que si vous les saisissez.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run typecheck` | Vérification TypeScript (frontend, Worker, tests) |
| `npm test` | Tests unitaires, d'intégration et de migration (Vitest, SQLite réel) |
| `npm run build` | Typage + build de production (Worker + interface) |
| `npm run test:api` | Scénarios de bout en bout contre `npm run dev` en cours d'exécution |
| `npm run reset-password` | Réinitialisation d'un mot de passe (voir le script) |

## Documentation

- [Installation et déploiement Cloudflare](docs/deployment.md) — **le déploiement n'est jamais lancé automatiquement**
- [Migration V1 → V2 et retour arrière](docs/migration.md)
- [Variables d'environnement et assistant IA](docs/environment.md)
- [Règles de calcul financier](docs/finance-rules.md)
- [Tests](docs/testing.md)
- [Sécurité, confidentialité et PWA](docs/security.md)
- [Limites connues](docs/known-limitations.md)
- [Audit de la V1](docs/v1-audit.md)

## Architecture

```
shared/    logique pure partagée (montants en centimes, règles de budget, récurrence, analyses, alertes…)
worker/    API Hono (/api/*) : routes/, lib/ (accès D1, IA, insights)
src/       interface React (pages/, components/, lib/)
migrations/ migrations D1 additives (0001 → 0005)
tests/     Vitest : FakeD1 sur node:sqlite, vraie application Hono, vraies migrations
docs/      documentation, requêtes d'intégrité, script de retour arrière
```

Principes : tous les montants sont des **entiers en centimes** ; les calculs financiers sont **déterministes et séparés
de l'IA** ; chaque requête est filtrée par utilisateur (clés étrangères composites `(id, user_id)`) ; rien n'est créé
automatiquement à votre place (abonnements et charges fixes ne deviennent des dépenses que lorsque vous cliquez « Payé »).
