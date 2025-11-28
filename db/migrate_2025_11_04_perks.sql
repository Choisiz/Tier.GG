BEGIN;

CREATE TABLE IF NOT EXISTS gameinfo_perks (
  id SERIAL PRIMARY KEY,
  match_id TEXT NOT NULL,
  puuid TEXT NOT NULL,
  slot_type TEXT NOT NULL,
  perk_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (match_id, puuid, slot_type, perk_id),
  FOREIGN KEY (puuid, match_id) REFERENCES matches(puuid, match_id) ON DELETE CASCADE
);

COMMIT;


