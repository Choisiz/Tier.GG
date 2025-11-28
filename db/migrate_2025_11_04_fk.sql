BEGIN;

-- 0) 데이터 정리: 자식부터 비우고 식별자 리셋
TRUNCATE TABLE gameinfo_bans, gameinfo, matches RESTART IDENTITY;

-- 1) players → matches (puuid) FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_matches__players'
  ) THEN
    ALTER TABLE matches
      ADD CONSTRAINT fk_matches__players
      FOREIGN KEY (puuid) REFERENCES players(puuid) ON DELETE CASCADE;
  END IF;
END $$;

-- 2) matches → gameinfo ((puuid, match_id)) FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_gameinfo__matches'
  ) THEN
    ALTER TABLE gameinfo
      ADD CONSTRAINT fk_gameinfo__matches
      FOREIGN KEY (puuid, match_id) REFERENCES matches(puuid, match_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3) matches → gameinfo_bans ((puuid, match_id)) FK
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_gameinfo_bans__matches'
  ) THEN
    ALTER TABLE gameinfo_bans
      ADD CONSTRAINT fk_gameinfo_bans__matches
      FOREIGN KEY (puuid, match_id) REFERENCES matches(puuid, match_id) ON DELETE CASCADE;
  END IF;
END $$;

COMMIT;



