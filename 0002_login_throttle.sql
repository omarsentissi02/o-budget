-- Tentatives de connexion échouées, pour limiter les essais de mots de passe.
CREATE TABLE auth_attempts (
  key        TEXT NOT NULL,     -- "email:<adresse>" ou "ip:<adresse IP>"
  created_at INTEGER NOT NULL   -- millisecondes
);
CREATE INDEX idx_auth_attempts ON auth_attempts(key, created_at);
