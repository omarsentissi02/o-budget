# Installation et déploiement Cloudflare

> Ce projet n'est **jamais** déployé automatiquement. Les commandes ci-dessous sont à lancer par vous.

## 1. Local
`npm install` → `npm run db:migrate:local` → `npm run dev`. Les données locales vivent dans `.wrangler/` (ignoré par git).

## 2. Première mise en ligne
1. `npx wrangler login`
2. `npx wrangler d1 create o-budget` puis copiez `database_id` dans `wrangler.jsonc` (le fichier contient un identifiant factice).
3. `npm run db:migrate:remote` — **sauvegardez d'abord** (voir `docs/migration.md`).
4. Facultatif, assistant IA : `npx wrangler secret put AI_API_KEY` et définissez `AI_PROVIDER`, `AI_MODEL` (voir `docs/environment.md`).
5. `npm run deploy`.
6. Créez votre compte, puis mettez `ALLOW_SIGNUP` à `"false"` dans `wrangler.jsonc` et redéployez.

## 3. Mise à jour depuis la V1 (base existante)
Suivez `docs/migration.md` : sauvegarde → migrations → vérifications d'intégrité → déploiement.

## 4. Après le déploiement
Ouvrez l'application, vérifiez vos totaux d'un mois connu, et exécutez `docs/integrity-checks.sql` (toutes les requêtes doivent renvoyer 0 ligne).
