CREATE TABLE IF NOT EXISTS ad_progress (
  user_id INTEGER PRIMARY KEY,
  energy_progress INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS roulette_spins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  reward REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_roulette_user ON roulette_spins(user_id, created_at);
