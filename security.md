# Sécurité, confidentialité, PWA

- **Sessions** : cookie `ob_session` (HttpOnly, SameSite), jeton haché (SHA-256) en base ; mots de passe PBKDF2 ; limitation des tentatives de connexion.
- **CSRF** : l'en-tête `Origin` doit correspondre ; sinon `Sec-Fetch-Site` doit valoir `same-origin`/`none` ; `Origin: null` est refusé.
- **Isolation** : toutes les requêtes filtrent par `user_id` ; les clés étrangères composites `(id, user_id)` empêchent un enfant de pointer vers la ligne d'un autre utilisateur (testé).
- **Secrets** : la clé IA n'existe que dans l'environnement du Worker ; aucune clé dans le dépôt ni dans le navigateur ; les erreurs du fournisseur ne sont jamais relayées telles quelles.
- **PWA** : le service worker ne met en cache que les fichiers de l'application (HTML, JS, CSS, icônes). **Aucune réponse `/api/*` n'est jamais mise en cache** ; l'ancien cache de données V1 est supprimé à l'activation ; mémoire de l'application vidée à la déconnexion et sur 401. Hors ligne : l'application s'ouvre mais n'affiche pas de données périmées.
- **CSV** : les cellules texte commençant par `= + - @` (ou tabulation/retour) sont préfixées d'une apostrophe.
- **En-têtes** : CSP stricte côté API, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`.
- **Alertes** : internes à l'application uniquement (pas de notification push).
