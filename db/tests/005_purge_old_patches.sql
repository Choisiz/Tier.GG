-- 005: purge_old_patches (db_spec 7-5, 8-5). 항상 ROLLBACK.
-- 패치 0.9 (2게임), 0.10 (3게임), 0.2 (4게임) → purge_old_patches(2) → 0.2 원본만 삭제 (0.10이 최신)
-- 주의: 실제 matches 데이터가 있으면 기대값이 달라지므로 이 검사를 건너뛴다 (삭제는 롤백되므로 안전하지만 결과 비교가 무의미).
DO $$
DECLARE
  v_deleted int;
  v_res jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM matches) THEN
    RAISE NOTICE '[건너뜀] matches에 실제 데이터가 있어 purge 검사를 건너뜁니다';
    RETURN;
  END IF;

  INSERT INTO matches (match_id, puuid, patch)
  SELECT 'KR_8000000' || lpad(g::text, 3, '0'), NULL,
         CASE WHEN g <= 2 THEN '0.9' WHEN g <= 5 THEN '0.10' ELSE '0.2' END
  FROM generate_series(1, 9) AS g;
  INSERT INTO match_players
  SELECT 'KR_8000000' || lpad(g::text, 3, '0'), 'pg' || g || '-' || s, 10 + s, 'TOP', s <= 5, NULL, 14, 4,
         8100, 9923, 8143, 8140, 8135, 8000, 8299, 9104, 5008, 5008, 5011, 1018, 0, 0, 0, 0, 0, NULL
  FROM generate_series(1, 9) AS g, generate_series(1, 10) AS s;

  v_res := refresh_patch_stats('0.2');   -- 0.2 집계를 먼저 만든다 (purge 뒤에도 남아야 함)

  -- 잘못된 인자
  BEGIN
    PERFORM purge_old_patches(0);
    RAISE EXCEPTION 'p_keep = 0 이 허용됨';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  v_deleted := purge_old_patches(2);
  IF v_deleted <> 4 THEN RAISE EXCEPTION '삭제한 게임 수 = %, 기대 4', v_deleted; END IF;
  IF (SELECT array_agg(DISTINCT patch ORDER BY patch) FROM matches) <> ARRAY['0.10', '0.9'] THEN
    RAISE EXCEPTION '남은 패치 불일치: %', (SELECT array_agg(DISTINCT patch) FROM matches);
  END IF;
  IF EXISTS (SELECT 1 FROM match_players WHERE match_id IN ('KR_8000000006','KR_8000000007','KR_8000000008','KR_8000000009')) THEN
    RAISE EXCEPTION 'match_players CASCADE 삭제 안 됨';
  END IF;
  IF (SELECT count(*) FROM match_players) <> 50 THEN
    RAISE EXCEPTION 'match_players 남은 줄 = %, 기대 50', (SELECT count(*) FROM match_players);
  END IF;
  IF (SELECT games FROM patch WHERE patch = '0.2') IS DISTINCT FROM 4
     OR (SELECT count(*) FROM champion WHERE patch = '0.2') <> 10 THEN
    RAISE EXCEPTION '집계 테이블이 지워짐';
  END IF;
  RAISE NOTICE '[통과] purge_old_patches(2) = % (0.2 삭제, 0.10·0.9 보관), match_players 90 → 50 줄, 0.2 집계 유지 (games 4, champion 10줄)', v_deleted;

  -- 한 번 더 부르면 지울 것이 없음
  v_deleted := purge_old_patches(2);
  IF v_deleted <> 0 THEN RAISE EXCEPTION '두 번째 purge 삭제 수 = %', v_deleted; END IF;
  RAISE NOTICE '[통과] 두 번째 purge_old_patches(2) = 0';
END $$;
