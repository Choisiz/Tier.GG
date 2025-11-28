BEGIN;

CREATE TABLE IF NOT EXISTS champion (
  id SERIAL PRIMARY KEY,
  stat_date DATE NOT NULL,
  champ_id INTEGER NOT NULL,
  position TEXT NULL,
  -- 챔피언 전체(포지션 무관) 합산값
  position_count INTEGER NOT NULL,
  total_wins INTEGER NOT NULL,
  total_pick_matches INTEGER NOT NULL,
  total_ban_matches INTEGER NOT NULL,
  total_pick_rate NUMERIC(5,2) NOT NULL,
  total_win_rate NUMERIC(5,2) NOT NULL,
  total_ban_rate NUMERIC(5,2) NOT NULL,
  total_matches INTEGER NOT NULL,
  -- 포지션별 지표
  pos_pick_matches INTEGER NOT NULL,
  pos_wins INTEGER NOT NULL,
  pos_pick_rate NUMERIC(5,2) NOT NULL,
  pos_win_rate NUMERIC(5,2) NOT NULL,
  -- 대표 빌드/룬(챔피언 기준 최빈)
  item1 INTEGER NULL,
  item2 INTEGER NULL,
  item3 INTEGER NULL,
  item4 INTEGER NULL,
  item5 INTEGER NULL,
  item6 INTEGER NULL,
  rune_primary1 INTEGER NULL,
  rune_primary2 INTEGER NULL,
  rune_primary3 INTEGER NULL,
  rune_primary4 INTEGER NULL,
  rune_sub1 INTEGER NULL,
  rune_sub2 INTEGER NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (stat_date, champ_id, position)
);

COMMIT;


