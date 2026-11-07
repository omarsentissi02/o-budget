-- O-Budget V2 — contrôles d'intégrité des données. Chaque requête doit renvoyer 0 ligne.
-- Exécution locale :  npx wrangler d1 execute o-budget --local --file docs/integrity-checks.sql
-- Exécution prod :    npx wrangler d1 execute o-budget --remote --file docs/integrity-checks.sql

-- 1. Dépenses sans aucun montant
SELECT 'entry_without_amount' AS check_name, e.id FROM expense_entries e
  LEFT JOIN expense_amounts a ON a.entry_id = e.id WHERE a.id IS NULL;

-- 2. Montants orphelins (entrée supprimée)
SELECT 'amount_orphan', a.id FROM expense_amounts a LEFT JOIN expense_entries e ON e.id = a.entry_id WHERE e.id IS NULL;

-- 3. Une dépense rattachée à la période d'un autre mois que sa date
SELECT 'entry_period_mismatch', e.id FROM expense_entries e JOIN financial_periods p ON p.id = e.period_id
  WHERE substr(e.spent_on, 1, 7) <> p.month;

-- 4. Montants non entiers ou négatifs (tout est en centimes entiers)
SELECT 'amount_not_integer', id FROM expense_amounts WHERE typeof(amount_cents) <> 'integer' OR amount_cents <= 0;
SELECT 'income_not_integer', id FROM incomes WHERE typeof(amount_cents) <> 'integer' OR amount_cents < 0;

-- 5. Isolation : un enfant ne doit jamais appartenir à un autre utilisateur que son parent
SELECT 'income_details_owner', d.income_id FROM income_details d JOIN incomes i ON i.id = d.income_id WHERE i.user_id <> d.user_id;
SELECT 'contribution_owner', c.id FROM goal_contributions c JOIN savings_goals g ON g.id = c.goal_id WHERE g.user_id <> c.user_id;
SELECT 'entry_owner', e.id FROM expense_entries e JOIN financial_periods p ON p.id = e.period_id WHERE p.user_id <> e.user_id;

-- 6. Catégories inconnues
SELECT 'unknown_category', a.id FROM expense_amounts a LEFT JOIN categories c ON c.id = a.category_id WHERE c.id IS NULL;

-- 7. Statut halal « verified » sans source
SELECT 'halal_without_source', merchant_id FROM merchant_prefs
  WHERE halal_status = 'verified' AND (halal_source IS NULL OR length(trim(halal_source)) = 0);

-- 8. Vérification générale des clés étrangères
PRAGMA foreign_key_check;
