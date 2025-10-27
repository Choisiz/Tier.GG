-- 초기 스키마
CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  puuid TEXT UNIQUE NOT NULL,
  tier TEXT,
  rank TEXT,
  wins INTEGER,
  losses INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_matches (
  id SERIAL PRIMARY KEY,
  puuid TEXT NOT NULL,
  match_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (puuid, match_id)
);

-- 업데이트 트리거용 함수(선택)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_players_updated ON players;
CREATE TRIGGER trg_players_updated
BEFORE UPDATE ON players
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


