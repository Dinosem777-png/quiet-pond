CREATE TABLE IF NOT EXISTS pass_progress (
  user_id INTEGER NOT NULL,
  season TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  claimed_level INTEGER NOT NULL DEFAULT 0,
  premium INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, season)
);
CREATE TABLE IF NOT EXISTS miner_levels (
  user_id INTEGER NOT NULL,
  miner_id INTEGER NOT NULL UNIQUE,
  level INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(user_id, miner_id)
);
