-- Faction progression: level 1 = +1% mining, max level 10 = +10%.
ALTER TABLE factions ADD COLUMN level INTEGER NOT NULL DEFAULT 1;

-- Stores the faction name a player entered while waiting for the 20 Stars payment.
CREATE TABLE IF NOT EXISTS faction_creation_requests (
  user_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
