# Variables d'environnement

| Variable | Type | Rôle |
|---|---|---|
| `ALLOW_SIGNUP` | var | `"false"` ferme les inscriptions. |
| `AI_PROVIDER` | var | `anthropic`, `openai` ou `openai-compatible`. |
| `AI_MODEL` | var | Identifiant du modèle chez votre fournisseur. Aucun nom de modèle n'est codé en dur. |
| `AI_API_KEY` | **secret** | `npx wrangler secret put AI_API_KEY`. Lu uniquement par le Worker. |
| `AI_BASE_URL` | var | Requis pour `openai-compatible` ; HTTPS obligatoire. |

Si une variable obligatoire manque, l'assistant conversationnel est « non configuré » : `/api/ai/chat` répond 503 et l'interface l'explique. **Aucune réponse n'est simulée.**

## Données envoyées au fournisseur
Uniquement des agrégats calculés par l'application (totaux du mois, catégories, nombre d'abonnements, tâches ouvertes…). Jamais : e-mail, nom, mot de passe, libellés de revenus, notes. Les noms d'établissements ne sont inclus que si vous activez « Partager le détail des établissements » (Paramètres). Les montants et formules sont calculés par le code, pas par le modèle ; l'assistant ne modifie rien : ses propositions de tâches attendent votre validation. Les messages sont conservés dans votre compte et supprimables.
