ALTER TABLE users ADD COLUMN total_clicks INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS economy_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  minted REAL NOT NULL DEFAULT 0,
  max_supply REAL NOT NULL DEFAULT 10000000
);
INSERT OR IGNORE INTO economy_state (id, minted, max_supply)
SELECT 1, COALESCE(SUM(balance), 0), 10000000 FROM users;

CREATE TABLE IF NOT EXISTS daily_task_progress (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  task_key TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, task_key)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id INTEGER NOT NULL,
  achievement_key TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_day ON daily_task_progress(user_id, day);
