-- O-Budget V2.0 → V1 : retour arrière de la base de données.
--
-- ⚠ DESTRUCTIF POUR LES DONNÉES V2 UNIQUEMENT. À lire avant d'exécuter.
--  CONSERVÉ   : utilisateurs, mois, revenus (montants, libellés, dates), épargne mensuelle, dépenses
--               (dates, lieux, moyens de paiement, descriptions, montants totaux), moyens de paiement.
--  PERDU      : tâches, notifications, historique de l'assistant, abonnements, charges fixes, budgets,
--               objectifs d'épargne, établissements/sous-catégories personnalisés, statuts halal, détails de revenus
--               (statut attendu/confirmé, brut/net, aides), préférences V2 (fuseau, réserve, objectif, solde de départ…).
--  FUSIONNÉ   : les dépenses rangées dans les 8 catégories ajoutées par la V2 (laverie, soins, telecom, voyage, assurance,
--               administration, cadeaux, exceptionnel) sont regroupées dans « Autre (ancien) » avec le MÊME montant total ;
--               le détail de leur catégorie d'origine est perdu.
--  ATTENTION  : les revenus V2 de statut « attendu / annulé / versé à un tiers » deviendraient des revenus « reçus » en V1
--               (la V1 ne connaît pas ces statuts). Ils sont SUPPRIMÉS ici pour ne pas gonfler vos soldes.
--
-- AVANT : exportez vos données (Paramètres → Données) et sauvegardez la base :
--   npx wrangler d1 export o-budget --remote --output=sauvegarde-avant-rollback.sql
-- Exécution : npx wrangler d1 execute o-budget --remote --file=docs/rollback-v2.sql
-- Puis déployez le code V1. Ne déployez jamais le code V2 sur une base revenue en V1 sans rejouer les migrations 0003 à 0005.

PRAGMA foreign_keys = OFF;

-- 1. Revenus V2 qui n'étaient pas de l'argent reçu : supprimés (voir avertissement).
DELETE FROM incomes WHERE id IN (
  SELECT income_id FROM income_details
  WHERE status NOT IN ('confirmed', 'completed') OR paid_to <> 'user'
);

-- 2. Dépenses dans les catégories V2 → « autre », montants fusionnés par dépense.
CREATE TEMP TABLE _merge AS
  SELECT entry_id, SUM(amount_cents) AS total
  FROM expense_amounts
  WHERE category_id IN ('autre', 'laverie', 'soins', 'telecom', 'voyage', 'assurance', 'administration', 'cadeaux', 'exceptionnel')
  GROUP BY entry_id
  HAVING SUM(CASE WHEN category_id <> 'autre' THEN 1 ELSE 0 END) > 0;
DELETE FROM expense_amounts
  WHERE category_id IN ('autre', 'laverie', 'soins', 'telecom', 'voyage', 'assurance', 'administration', 'cadeaux', 'exceptionnel')
    AND entry_id IN (SELECT entry_id FROM _merge);
INSERT INTO expense_amounts (id, entry_id, category_id, amount_cents)
  SELECT lower(hex(randomblob(16))), entry_id, 'autre', total FROM _merge;
DROP TABLE _merge;

-- 3. Tables V2 (enfants avant parents).
DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS task_categories;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS goal_contributions;
DROP TABLE IF EXISTS savings_goals;
DROP TABLE IF EXISTS recurring_items;
DROP TABLE IF EXISTS budgets;
DROP TABLE IF EXISTS income_details;
DROP TABLE IF EXISTS merchant_prefs;
DROP TABLE IF EXISTS merchants;
DROP TABLE IF EXISTS subcategories;

-- 4. Index V2 puis colonnes V2 (DROP COLUMN : SQLite ≥ 3.35, pris en charge par D1).
DROP INDEX IF EXISTS uq_incomes_id_user;
DROP INDEX IF EXISTS idx_amounts_category;
DROP INDEX IF EXISTS idx_amounts_merchant;
DROP INDEX IF EXISTS idx_entries_user_date;
ALTER TABLE expense_amounts DROP COLUMN subcategory_id;
ALTER TABLE expense_amounts DROP COLUMN merchant_id;
ALTER TABLE expense_amounts DROP COLUMN merchant_label;
ALTER TABLE expense_amounts DROP COLUMN platform_id;
ALTER TABLE expense_amounts DROP COLUMN trip_from;
ALTER TABLE expense_amounts DROP COLUMN trip_to;
ALTER TABLE expense_amounts DROP COLUMN trip_date;
ALTER TABLE expense_amounts DROP COLUMN note;
ALTER TABLE expense_entries DROP COLUMN notes;
ALTER TABLE expense_entries DROP COLUMN channel;
ALTER TABLE user_settings DROP COLUMN timezone;
ALTER TABLE user_settings DROP COLUMN safety_reserve_cents;
ALTER TABLE user_settings DROP COLUMN monthly_savings_target_cents;
ALTER TABLE user_settings DROP COLUMN opening_balance_cents;
ALTER TABLE user_settings DROP COLUMN opening_balance_month;
ALTER TABLE user_settings DROP COLUMN alert_prefs;
ALTER TABLE user_settings DROP COLUMN ai_share_detail;

-- 5. Catégories ajoutées par la V2.
DELETE FROM categories WHERE id IN ('laverie', 'soins', 'telecom', 'voyage', 'assurance', 'administration', 'cadeaux', 'exceptionnel');

-- 6. Permet de rejouer les migrations V2 plus tard (table de suivi de wrangler).
DELETE FROM d1_migrations WHERE name IN ('0003_v2_expenses_taxonomy.sql', '0004_v2_income_budget_subscriptions.sql', '0005_v2_tasks_alerts_ai.sql');

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
