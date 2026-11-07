# Audit de la V1 (constats utilisés pour la V2)

1. **`wrangler.jsonc` absent** de l'archive V1 : le build produisait un Worker sans liaison D1. Ajouté (identifiant factice à remplacer).
2. **Cache PWA des données** : `/api/*` mis en cache par URL sans distinction d'utilisateur ; sur un appareil partagé, des données financières pouvaient être relues après changement de compte. Corrigé (plus de cache API).
3. **CSRF** : un en-tête `Origin: null` provoquait une erreur non gérée (`new URL("null")`), et une requête sans `Origin` était acceptée sans autre contrôle. V2 : `Origin: null` → 403 ; sans `Origin`, `Sec-Fetch-Site` doit valoir `same-origin` ou `none`.
4. **Export CSV** : cellules texte non neutralisées contre l'injection de formules. Corrigé.
5. **Fuseau horaire** : la V1 n'avait pas besoin de « jour courant » côté serveur ; la V2 (jours restants, échéances, tâches) en a besoin et le Worker tourne en UTC. Ajout d'un fuseau utilisateur (`Europe/Paris` par défaut).
6. **Revenus par défaut** : l'application des montants habituels les comptait immédiatement comme reçus. Proposé désormais comme « attendus » (choix explicite).
7. **Pas de contrainte d'isolation en base** entre parent et enfant : clés étrangères composites ajoutées pour les nouvelles tables.
