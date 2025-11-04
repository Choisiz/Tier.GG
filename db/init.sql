-- 플레이어 테이블
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

-- 플레이어 매치 테이블
CREATE TABLE IF NOT EXISTS player_matches (
  id SERIAL PRIMARY KEY,
  puuid TEXT NOT NULL,
  match_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (puuid, match_id)
);

-- 통합 매치 상세 테이블
CREATE TABLE IF NOT EXISTS match_details (
  id SERIAL PRIMARY KEY,
  match_id TEXT NOT NULL,      --매치id
  puuid TEXT NOT NULL,         --참가자puuid
  game_version TEXT,           --게임버전
  game_mode TEXT,              --게임모드
  game_result BOOLEAN,         --게임결과
  pick_champion_id INTEGER,    --선택챔피언 아이디
  position TEXT,               --라인 포지션
  item0 INTEGER,               --아이템 0
  item1 INTEGER,               --아이템 1
  item2 INTEGER,               --아이템 2
  item3 INTEGER,               --아이템 3
  item4 INTEGER,               --아이템 4
  item5 INTEGER,               --아이템 5
  item6 INTEGER,               --아이템 6
  spell1_casts INTEGER,        --스펠1 캐스트
  spell2_casts INTEGER,        --스펠2 캐스트
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (match_id, puuid)
);

-- 통합 매치 벤픽 테이블
CREATE TABLE IF NOT EXISTS match_defails_ban (
  match_id TEXT NOT NULL,
  ban_champion_id INTEGER NOT NULL,
  puuid TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (match_id, puuid, ban_champion_id)
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


