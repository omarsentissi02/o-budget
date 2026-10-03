-- O-Budget : schéma initial (Cloudflare D1 / SQLite)
-- Les montants sont stockés en centimes (INTEGER) pour éviter les erreurs d'arrondi.

CREATE TABLE users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name                TEXT NOT NULL DEFAULT '',
  password_hash       TEXT NOT NULL,
  password_salt       TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Le jeton de session n'est jamais stocké en clair : seul son hash SHA-256 l'est.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE user_settings (
  user_id                  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_alternance_cents INTEGER NOT NULL DEFAULT 120200 CHECK (default_alternance_cents >= 0),
  default_freelance_cents  INTEGER NOT NULL DEFAULT 50000  CHECK (default_freelance_cents >= 0),
  currency                 TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  theme                    TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE payment_methods (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_payment_methods_user ON payment_methods(user_id);

-- Catégories fixes et larges (pas de sous-catégories).
CREATE TABLE categories (
  id       TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  emoji    TEXT NOT NULL,
  position INTEGER NOT NULL
);
INSERT INTO categories (id, label, emoji, position) VALUES
  ('logement',     'Logement',     '🏠', 1),
  ('alimentation', 'Alimentation', '🍔', 2),
  ('transport',    'Transport',    '🚆', 3),
  ('sport',        'Sport',        '🏋️', 4),
  ('loisirs',      'Loisirs',      '🎮', 5),
  ('abonnements',  'Abonnements',  '📱', 6),
  ('etudes',       'Études',       '🎓', 7),
  ('shopping',     'Shopping',     '🛍', 8),
  ('sante',        'Santé',        '💊', 9),
  ('autre',        'Autre',        '📦', 10);

-- Un mois = une période financière.
CREATE TABLE financial_periods (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, month),
  UNIQUE (id, user_id)
);

-- Revenus réels du mois. Les montants par défaut des paramètres y sont COPIÉS :
-- modifier un défaut ne change jamais un mois existant.
CREATE TABLE incomes (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  period_id   TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('alternance', 'freelance', 'other')),
  label       TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  received_on TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (period_id, user_id) REFERENCES financial_periods(id, user_id) ON DELETE CASCADE
);
CREATE INDEX idx_incomes_period ON incomes(user_id, period_id);
-- Une seule ligne Alternance et une seule ligne Freelance par mois ; « Autre » illimité.
CREATE UNIQUE INDEX uq_incomes_main_source ON incomes(period_id, source)
  WHERE source IN ('alternance', 'freelance');

-- Épargne du mois (suivie séparément des dépenses).
CREATE TABLE savings (
  period_id    TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (period_id, user_id) REFERENCES financial_periods(id, user_id) ON DELETE CASCADE
);

-- Une saisie de dépense (un jour, un lieu, un moyen de paiement)...
CREATE TABLE expense_entries (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  period_id         TEXT NOT NULL,
  spent_on          TEXT NOT NULL,
  location_type     TEXT NOT NULL CHECK (location_type IN ('france', 'abroad')),
  country_code      TEXT,
  country_name      TEXT NOT NULL,
  city              TEXT,
  payment_method_id TEXT REFERENCES payment_methods(id) ON DELETE SET NULL,
  payment_label     TEXT NOT NULL,
  description       TEXT,
  client_request_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (period_id, user_id) REFERENCES financial_periods(id, user_id) ON DELETE CASCADE,
  UNIQUE (user_id, client_request_id)
);
CREATE INDEX idx_entries_period ON expense_entries(user_id, period_id, spent_on);

-- ...qui contient un montant par catégorie choisie.
CREATE TABLE expense_amounts (
  id           TEXT PRIMARY KEY,
  entry_id     TEXT NOT NULL REFERENCES expense_entries(id) ON DELETE CASCADE,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  UNIQUE (entry_id, category_id)
);
CREATE INDEX idx_amounts_entry ON expense_amounts(entry_id);
