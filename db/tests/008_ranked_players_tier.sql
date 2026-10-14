-- 008: ranked_players.tier 허용 값 (db_spec 변경 02-5). 항상 ROLLBACK.
--
-- 확인
--   허용: PLATINUM, EMERALD, DIAMOND, MASTER, GRANDMASTER, CHALLENGER 6개 INSERT 성공
--   거부 (23514): IRON, BRONZE, SILVER, GOLD (D11 제외 유지), 소문자 platinum, 빈 문자열 '' → 6개
--   구조: ranked_players_tier_check 정의에 PLATINUM, convalidated = true, CHECK는 tier_check·rank_check 2개뿐
--   FK: PLATINUM 플레이어를 matches.puuid로 참조하는 1줄 INSERT 성공 (패치 0.4)
DO $$
DECLARE
  v_tier text;
  v_n int := 0;
  v_got text;
  v_valid boolean;
BEGIN
  -- 허용 6개
  INSERT INTO ranked_players (puuid, tier, rank)
  SELECT 'test-008-' || lower(t), t, 'I'
  FROM unnest(ARRAY['PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']) AS t;
  SELECT count(*) INTO v_n FROM ranked_players WHERE puuid LIKE 'test-008-%';
  IF v_n <> 6 THEN RAISE EXCEPTION '허용 티어 INSERT 수 불일치 (6 기대): %', v_n; END IF;
  RAISE NOTICE '[통과] 허용: PLATINUM, EMERALD, DIAMOND, MASTER, GRANDMASTER, CHALLENGER 6개 저장';

  -- 거부 6개
  v_n := 0;
  FOREACH v_tier IN ARRAY ARRAY['IRON', 'BRONZE', 'SILVER', 'GOLD', 'platinum', ''] LOOP
    BEGIN
      INSERT INTO ranked_players (puuid, tier, rank) VALUES ('test-008-bad-' || v_tier, v_tier, 'I');
      RAISE EXCEPTION 'ranked_players.tier = ''%'' 이 허용됨', v_tier;
    EXCEPTION WHEN check_violation THEN v_n := v_n + 1;
    END;
  END LOOP;
  IF v_n <> 6 THEN RAISE EXCEPTION '거부 개수 불일치 (6 기대): %', v_n; END IF;
  RAISE NOTICE '[통과] 거부 (23514) %건: IRON, BRONZE, SILVER, GOLD, platinum, 빈 문자열', v_n;

  -- 구조
  SELECT pg_get_constraintdef(oid), convalidated INTO v_got, v_valid FROM pg_constraint
  WHERE conrelid = 'ranked_players'::regclass AND conname = 'ranked_players_tier_check' AND contype = 'c';
  IF v_got IS NULL OR v_got NOT LIKE '%''PLATINUM''%' THEN
    RAISE EXCEPTION 'ranked_players_tier_check 에 PLATINUM 없음: %', v_got;
  END IF;
  IF v_valid IS NOT TRUE THEN RAISE EXCEPTION 'ranked_players_tier_check 가 검증되지 않음 (NOT VALID)'; END IF;
  SELECT string_agg(conname, ',' ORDER BY conname) INTO v_got FROM pg_constraint
  WHERE conrelid = 'ranked_players'::regclass AND contype = 'c';
  IF v_got IS DISTINCT FROM 'ranked_players_rank_check,ranked_players_tier_check' THEN
    RAISE EXCEPTION 'ranked_players CHECK 목록 불일치: %', v_got;
  END IF;
  RAISE NOTICE '[통과] 구조: CHECK 2개(%), tier_check convalidated = true', v_got;

  -- FK
  INSERT INTO matches (match_id, puuid, patch) VALUES ('KR_9000000001', 'test-008-platinum', '0.4');
  SELECT count(*) INTO v_n FROM matches m JOIN ranked_players r ON r.puuid = m.puuid
  WHERE m.match_id = 'KR_9000000001' AND r.tier = 'PLATINUM';
  IF v_n <> 1 THEN RAISE EXCEPTION 'PLATINUM 표본을 참조하는 matches 줄 불일치: %', v_n; END IF;
  RAISE NOTICE '[통과] FK: PLATINUM 표본을 matches.puuid로 참조하는 1줄 저장 (패치 0.4)';
END $$;
