# Limites connues et éléments non implémentés

- **Catégories principales personnalisées** : non implémentées (sous-catégories et établissements personnalisés : oui).
- **Une ligne par catégorie** et par dépense (contrainte V1 conservée) : regroupez les montants d'une même catégorie.
- **Pas de notification push** ni d'e-mail : alertes dans l'application seulement.
- **Pas d'intégration CAF/banque** ni de calcul d'éligibilité aux aides ; pas de scraping de plateformes commerciales. Les aides sont saisies à la main.
- **Statut halal** : jamais déduit. Tous les établissements commencent « non renseigné » ; « vérifié » exige une source écrite par vous.
- **Assistant IA** : activé seulement si le serveur est configuré ; non testé contre de vrais fournisseurs (tests avec réponses simulées du réseau).
- **Aperçu** : un seul mois à la fois (sélecteur de mois) ; la prévision est limitée à 6 mois.
- **Hors ligne** : lecture impossible des données (choix de confidentialité, voir sécurité).
- **Tâches** : pas de sous-tâches ni de rappels sonores ; récurrence simple (quotidienne, jours ouvrés, hebdo, mensuelle, annuelle).
- **Tests de l'interface** : manuels (pas de tests automatisés des écrans React).
- **Tests** : Node ≥ 22.13 requis (`node:sqlite`).
- **Production** : `wrangler.jsonc` contient un `database_id` factice à remplacer.
