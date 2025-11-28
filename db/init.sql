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

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  puuid TEXT NOT NULL,
  match_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (puuid, match_id)
);

-- 통합 매치 상세 테이블
CREATE TABLE IF NOT EXISTS gameinfo (
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
  UNIQUE (match_id, puuid),
  -- FK 제거: 파이프라인 단계별 독립 동작을 위해 애플리케이션 레벨에서 정합성 관리
  -- FOREIGN KEY (puuid, match_id) REFERENCES matches(puuid, match_id) ON DELETE CASCADE
);

-- 통합 매치 벤픽 테이블
CREATE TABLE IF NOT EXISTS gameinfo_bans (
  match_id TEXT NOT NULL,
  ban_champion_id INTEGER NOT NULL,
  puuid TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (match_id, puuid, ban_champion_id)
);

-- 통합 매치 룬 테이블
CREATE TABLE IF NOT EXISTS gameinfo_perks (
  id SERIAL PRIMARY KEY,
  match_id TEXT NOT NULL,
  puuid TEXT NOT NULL,
  slot_type TEXT NOT NULL,         -- 'primary' | 'sub'
  perk_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (match_id, puuid, slot_type, perk_id)
);

-- 챔피언 집계 테이블
CREATE TABLE IF NOT EXISTS champion (
  id SERIAL PRIMARY KEY,
  stat_date DATE NOT NULL,
  champion_id INTEGER NOT NULL,
  position TEXT NOT NULL, -- 포지션별 1행
  total_win INTEGER NOT NULL,
  total_pick INTEGER NOT NULL,
  total_ban INTEGER NOT NULL,
  rate_total_pick NUMERIC(5,2) NOT NULL,
  rate_total_win NUMERIC(5,2) NOT NULL,
  rate_total_ban NUMERIC(5,2) NOT NULL,
  total_matches INTEGER NOT NULL,
  position_pick INTEGER NOT NULL,
  position_wins INTEGER NOT NULL,
  rate_position_pick NUMERIC(5,2) NOT NULL,
  rate_position_win NUMERIC(5,2) NOT NULL,
  item1 INTEGER, item2 INTEGER, item3 INTEGER, item4 INTEGER, item5 INTEGER, item6 INTEGER,
  rune_primary1 INTEGER, rune_primary2 INTEGER, rune_primary3 INTEGER, rune_primary4 INTEGER,
  rune_sub1 INTEGER, rune_sub2 INTEGER,
  create_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (stat_date, champion_id, position)
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


