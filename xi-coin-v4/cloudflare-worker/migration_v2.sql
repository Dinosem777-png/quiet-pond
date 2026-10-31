-- Xi Coin v2: energy regeneration and daily login streak
ALTER TABLE users ADD COLUMN energy_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN last_daily_day TEXT;
ALTER TABLE users ADD COLUMN daily_streak INTEGER NOT NULL DEFAULT 0;
