-- O-Budget V2.0 — migration 0004 : revenus détaillés, budgets, charges fixes, épargne, abonnements.
-- Additive. Les revenus V1 (table incomes) sont conservés tels quels : ils n'ont pas de ligne dans
-- income_details et sont traités comme « confirmés, versés à l'utilisateur » (comportement V1 inchangé).

-- Nécessaire pour les clés étrangères composites (id, user_id) : un enfant ne peut jamais pointer vers
-- la ligne d'un autre utilisateur.
CREATE UNIQUE INDEX uq_incomes_id_user ON incomes(id, user_id);

CREATE TABLE income_details (
  income_id                    TEXT PRIMARY KEY,
  user_id                      TEXT NOT NULL,
  kind                         TEXT NOT NULL,
  status                       TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('expected', 'pending', 'approved', 'confirmed', 'completed', 'suspended', 'cancelled')),
  frequency                    TEXT NOT NULL DEFAULT 'once' CHECK (frequency IN ('once', 'weekly', 'monthly', 'quarterly', 'yearly')),
  expected_date                TEXT,
  gross_cents                  INTEGER CHECK (gross_cents IS NULL OR gross_cents >= 0),
  employee_contributions_cents INTEGER CHECK (employee_contributions_cents IS NULL OR employee_contributions_cents >= 0),
  other_deductions_cents       INTEGER CHECK (other_deductions_cents IS NULL OR other_deductions_cents >= 0),
  withholding_cents            INTEGER CHECK (withholding_cents IS NULL OR withholding_cents >= 0),
  organization                 TEXT,
  benefit_type                 TEXT,
  estimated_cents              INTEGER CHECK (estimated_cents IS NULL OR estimated_cents >= 0),
  confirmed_cents              INTEGER CHECK (confirmed_cents IS NULL OR confirmed_cents >= 0),
  paid_to                      TEXT NOT NULL DEFAULT 'user' CHECK (paid_to IN ('user', 'third_party')),
  third_party_name             TEXT,
  notes                        TEXT,
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (income_id, user_id) REFERENCES incomes(id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_income_details_user ON income_details(user_id, status);

-- Budgets mensuels par catégorie.
CREATE TABLE budgets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, category_id, month)
);
CREATE INDEX idx_budgets_month ON budgets(user_id, month);

-- Charges fixes / dépenses récurrentes planifiées (loyer, assurance, crédit…).
-- Une échéance ne devient une dépense QUE lorsque l'utilisateur la marque comme payée (rien n'est créé automatiquement).
CREATE TABLE recurring_items (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  frequency         TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_date     TEXT NOT NULL,
  anchor_date       TEXT NOT NULL,
  end_date          TEXT,
  category_id       TEXT NOT NULL REFERENCES categories(id),
  subcategory_id    TEXT,
  payment_method_id TEXT REFERENCES payment_methods(id) ON DELETE SET NULL,
  payment_label     TEXT NOT NULL DEFAULT 'Autre',
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  last_paid_on      TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_recurring_user_due ON recurring_items(user_id, active, next_due_date);

-- Objectifs d'épargne et réserves financières.
CREATE TABLE savings_goals (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  target_cents         INTEGER NOT NULL CHECK (target_cents > 0),
  deadline             TEXT,
  monthly_target_cents INTEGER CHECK (monthly_target_cents IS NULL OR monthly_target_cents >= 0),
  is_reserve           INTEGER NOT NULL DEFAULT 0 CHECK (is_reserve IN (0, 1)),
  archived             INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (id, user_id)
);
CREATE INDEX idx_goals_user ON savings_goals(user_id, archived);

CREATE TABLE goal_contributions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  goal_id        TEXT NOT NULL,
  -- Positif = versement, négatif = retrait.
  amount_cents   INTEGER NOT NULL CHECK (amount_cents <> 0),
  contributed_on TEXT NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (goal_id, user_id) REFERENCES savings_goals(id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_contrib_goal ON goal_contributions(user_id, goal_id, contributed_on);

-- Abonnements.
CREATE TABLE subscriptions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  family             TEXT NOT NULL CHECK (family IN ('pro', 'personal', 'transport')),
  category_id        TEXT NOT NULL REFERENCES categories(id),
  subcategory_id     TEXT,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  frequency          TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  start_date         TEXT,
  renewal_date       TEXT,
  payment_method_id  TEXT REFERENCES payment_methods(id) ON DELETE SET NULL,
  payment_label      TEXT NOT NULL DEFAULT 'Autre',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trial', 'paused', 'cancelled')),
  cancelled_on       TEXT,
  cancel_notice_days INTEGER CHECK (cancel_notice_days IS NULL OR cancel_notice_days >= 0),
  cancel_url         TEXT,
  cancel_notes       TEXT,
  notes              TEXT,
  last_paid_on       TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id, status, renewal_date);
