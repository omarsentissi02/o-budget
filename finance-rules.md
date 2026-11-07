# Règles de calcul (déterministes, `shared/budget.ts`)

- **Argent reçu** : revenu au statut *confirmé* ou *terminé* **et** versé à l'utilisateur. *Attendu / en attente / accordé* = prévision. *Versé à un tiers* = jamais du cash. *Suspendu / annulé* = exclu.
- **Solde du mois** = reçu − dépenses. **Disponible** = solde − épargne déjà mise de côté.
- **Dépense conseillée par jour** = (disponible − échéances non payées jusqu'à la fin du mois − épargne prévue restante − réserve de sécurité) ÷ jours restants (aujourd'hui inclus, min. 1). Jamais négatif ; le manque est affiché séparément.
- **Projection de fin de mois** (prudente) : sans revenus attendus, au rythme des dépenses *variables* (hors logement, assurance, abonnements, télécoms, exceptionnel). Le scénario « avec revenus attendus » est présenté à part.
- **Solde du compte** (si solde de départ saisi) = départ + reçu − dépenses − épargne depuis le mois de départ.
- **Abonnements / charges fixes** : coût mensuel (hebdo × 52/12, trimestriel ÷ 3, annuel ÷ 12). Une échéance devient une dépense uniquement via « Payé » (protégé contre le double clic).
- **Dépenses inhabituelles** : historique 180 j, ≥ 6 dépenses dans la catégorie, seuil = max(Q3 + 1,5 × écart interquartile ; 2 × médiane), plancher 20 €, ou catégorie ≥ 1,5 × sa moyenne sur 3 mois et ≥ 40 € de plus.
- **Prévision** : revenus récurrents saisis, échéances récurrentes et abonnements, moyenne des dépenses variables passées, objectif d'épargne. Rien d'autre.
- Aucune éligibilité à une aide n'est calculée ; aucune donnée CAF n'est récupérée.
