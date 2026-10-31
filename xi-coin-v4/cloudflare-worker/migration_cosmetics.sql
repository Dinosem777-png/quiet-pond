CREATE TABLE IF NOT EXISTS user_cosmetics (
  user_id INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  item_type TEXT NOT NULL,
  equipped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id,item_key)
);
CREATE INDEX IF NOT EXISTS idx_user_cosmetics_equipped
ON user_cosmetics(user_id,item_type,equipped);