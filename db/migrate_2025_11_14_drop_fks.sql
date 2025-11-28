BEGIN;

-- Drop foreign keys without relying on specific constraint names
-- gameinfo → matches
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'gameinfo'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE gameinfo DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- gameinfo_bans → matches
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'gameinfo_bans'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE gameinfo_bans DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- gameinfo_perks → matches
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'gameinfo_perks'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE gameinfo_perks DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- matches → players
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'matches'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE matches DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

COMMIT;


