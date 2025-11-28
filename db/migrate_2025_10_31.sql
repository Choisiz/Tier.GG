BEGIN;

-- 1) 불필요 테이블 제거(존재 시)
DROP TABLE IF EXISTS matches_info;
DROP TABLE IF EXISTS match_bans;
DROP TABLE IF EXISTS match_participants;

-- 2) gameinfo 컬럼 마이그레이션
-- 2-1) game_result 컬럼 추가 (없으면)
ALTER TABLE gameinfo ADD COLUMN IF NOT EXISTS game_result BOOLEAN;

-- 2-2) 기존 result 컬럼이 있으면 game_result로 이전
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'gameinfo' AND column_name = 'result'
  ) THEN
    EXECUTE 'UPDATE gameinfo SET game_result = result WHERE game_result IS NULL';
  END IF;
END $$;

-- 2-3) 더 이상 사용하지 않는 컬럼 제거(존재 시)
ALTER TABLE gameinfo
  DROP COLUMN IF EXISTS result,
  DROP COLUMN IF EXISTS team_id,
  DROP COLUMN IF EXISTS ban_champion_ids,
  DROP COLUMN IF EXISTS legendary_item_used,
  DROP COLUMN IF EXISTS perk_primary_style,
  DROP COLUMN IF EXISTS perk_sub_style,
  DROP COLUMN IF EXISTS perk_stat_defense,
  DROP COLUMN IF EXISTS perk_stat_flex,
  DROP COLUMN IF EXISTS perk_stat_offense,
  DROP COLUMN IF EXISTS perk0,
  DROP COLUMN IF EXISTS perk1,
  DROP COLUMN IF EXISTS perk2,
  DROP COLUMN IF EXISTS perk3,
  DROP COLUMN IF EXISTS perk4,
  DROP COLUMN IF EXISTS perk5;

-- 3) 밴 테이블 생성 (없으면)
CREATE TABLE IF NOT EXISTS gameinfo_bans (
  match_id TEXT NOT NULL,
  ban_champion_id INTEGER NOT NULL,
  puuid TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (match_id, puuid, ban_champion_id)
);

COMMIT;


