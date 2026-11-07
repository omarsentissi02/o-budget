-- O-Budget V2.0 — migration 0005 : tâches, notifications, historique de l'assistant IA. Additive.

CREATE TABLE task_categories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#4F5BD5' CHECK (color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX uq_task_categories_name ON task_categories(user_id, name COLLATE NOCASE);

CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'important', 'normal')),
  status            TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  -- Date et heure d'échéance en heure LOCALE de l'utilisateur (calendrier civil, sans fuseau).
  due_date          TEXT,
  due_time          TEXT CHECK (due_time IS NULL OR due_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR (estimated_minutes > 0 AND estimated_minutes <= 1440)),
  category_id       TEXT REFERENCES task_categories(id) ON DELETE SET NULL,
  recurrence        TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  -- Les occurrences d'une tâche récurrente partagent le même series_id.
  series_id         TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at      TEXT,
  CHECK (due_time IS NULL OR due_date IS NOT NULL)
);
CREATE INDEX idx_tasks_user_due ON tasks(user_id, status, due_date);
CREATE INDEX idx_tasks_series ON tasks(series_id) WHERE series_id IS NOT NULL;

-- Notifications générées par des règles déterministes ; (user_id, dedupe_key) évite les doublons.
CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key   TEXT NOT NULL,
  kind         TEXT NOT NULL,
  level        TEXT NOT NULL CHECK (level IN ('info', 'attention', 'critical')),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  link         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at      TEXT,
  dismissed_at TEXT,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX idx_notifications_user ON notifications(user_id, dismissed_at, created_at);

-- Conversation avec l'assistant. Le contenu vient de l'utilisateur et du fournisseur IA configuré ;
-- il n'est jamais fabriqué localement. Supprimable depuis les paramètres.
CREATE TABLE ai_messages (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_ai_messages_user ON ai_messages(user_id, created_at);
