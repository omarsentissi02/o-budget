-- O-Budget V2.0 — migration 0003 : paramètres étendus, taxonomie de dépenses, marchands.
-- 100 % ADDITIVE : aucune table V1 n'est supprimée ni réécrite, aucune donnée existante n'est modifiée.
-- Les dépenses V1 restent valides telles quelles (les nouvelles colonnes sont NULL pour elles).

-- ---- Paramètres utilisateur ------------------------------------------------------------------
ALTER TABLE user_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Paris';
ALTER TABLE user_settings ADD COLUMN safety_reserve_cents INTEGER NOT NULL DEFAULT 0 CHECK (safety_reserve_cents >= 0);
ALTER TABLE user_settings ADD COLUMN monthly_savings_target_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_savings_target_cents >= 0);
-- Solde de départ facultatif : sans lui, l'application n'affiche pas de « solde du compte » (elle ne l'invente pas).
ALTER TABLE user_settings ADD COLUMN opening_balance_cents INTEGER;
ALTER TABLE user_settings ADD COLUMN opening_balance_month TEXT;
-- Préférences d'alertes (JSON validé côté serveur).
ALTER TABLE user_settings ADD COLUMN alert_prefs TEXT NOT NULL DEFAULT '{}';
-- 0 = l'assistant IA ne reçoit que des agrégats ; 1 = il peut aussi recevoir les établissements les plus dépensiers.
ALTER TABLE user_settings ADD COLUMN ai_share_detail INTEGER NOT NULL DEFAULT 0 CHECK (ai_share_detail IN (0, 1));

-- ---- Catégories principales ajoutées en V2 (les 10 de la V1 sont conservées) ---------------------
INSERT OR IGNORE INTO categories (id, label, emoji, position) VALUES
  ('laverie',        'Laverie & pressing',       '🧺', 11),
  ('soins',          'Coiffure & hygiène',       '💈', 12),
  ('telecom',        'Télécommunications',       '📶', 13),
  ('voyage',         'Voyages & hébergement',    '✈️', 14),
  ('assurance',      'Assurances',               '🛡️', 15),
  ('administration', 'Administration',           '🗂️', 16),
  ('cadeaux',        'Cadeaux',                  '🎁', 17),
  ('exceptionnel',   'Dépenses exceptionnelles', '⚡', 18);

-- ---- Dépenses : champs enrichis (tous facultatifs) --------------------------------------------------
ALTER TABLE expense_entries ADD COLUMN notes TEXT;
ALTER TABLE expense_entries ADD COLUMN channel TEXT CHECK (channel IS NULL OR channel IN ('in_store', 'takeaway', 'delivery', 'online', 'app'));

-- Une « ligne » (expense_amounts) = un montant dans une catégorie, avec sous-catégorie, établissement, plateforme.
-- Les libellés sont recopiés (snapshot) : renommer un marchand ne réécrit pas l'historique.
ALTER TABLE expense_amounts ADD COLUMN subcategory_id TEXT;
ALTER TABLE expense_amounts ADD COLUMN merchant_id TEXT;
ALTER TABLE expense_amounts ADD COLUMN merchant_label TEXT;
ALTER TABLE expense_amounts ADD COLUMN platform_id TEXT;
ALTER TABLE expense_amounts ADD COLUMN trip_from TEXT;
ALTER TABLE expense_amounts ADD COLUMN trip_to TEXT;
ALTER TABLE expense_amounts ADD COLUMN trip_date TEXT;
ALTER TABLE expense_amounts ADD COLUMN note TEXT;

CREATE INDEX idx_amounts_category ON expense_amounts(category_id);
CREATE INDEX idx_amounts_merchant ON expense_amounts(merchant_id) WHERE merchant_id IS NOT NULL;
CREATE INDEX idx_entries_user_date ON expense_entries(user_id, spent_on);

-- ---- Sous-catégories personnalisées (les sous-catégories système sont définies dans le code) --------
CREATE TABLE subcategories (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  label       TEXT NOT NULL,
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX uq_subcategories_label ON subcategories(user_id, category_id, label COLLATE NOCASE);

-- ---- Marchands personnalisés (l'annuaire système est défini dans le code, identifiants « m_* ») --------
CREATE TABLE merchants (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT NOT NULL,
  category_id    TEXT REFERENCES categories(id),
  subcategory_id TEXT,
  archived       INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX uq_merchants_label ON merchants(user_id, label COLLATE NOCASE);

-- Mémoire d'usage (accélère la saisie) + statut halal vérifiable, pour marchands système ET personnels.
-- Le statut « verified » exige une source (certificat, site officiel, note…) : on ne déduit jamais le halal d'un nom.
CREATE TABLE merchant_prefs (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant_id        TEXT NOT NULL,
  use_count          INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at       TEXT,
  halal_status       TEXT NOT NULL DEFAULT 'unknown' CHECK (halal_status IN ('unknown', 'claimed', 'verified')),
  halal_source       TEXT,
  halal_verified_at  TEXT,
  PRIMARY KEY (user_id, merchant_id),
  CHECK (halal_status <> 'verified' OR (halal_source IS NOT NULL AND length(trim(halal_source)) > 0))
);
