-- 007: champion_skill 앞 11레벨 규칙 (db_spec 변경 01-5, 변경 03). 샘플 패치 '0.3', 시작 2021-01-10, 항상 ROLLBACK.
-- 집계는 refresh_window_stats(14, '2021-01-15+00') (창 [2021-01-01, 2021-01-15), 실제 데이터와 섞이지 않음).
--
-- 샘플 설계 (게임 g = 1~12, 참가자 s = 1~10, 1~5 = A팀, A팀 승리 = g 짝수)
--   s1  챔피언 31 TOP. 게임마다 다른 앞 11글자 (QQQQQEEEE + 2글자), 1판씩
--       승리(g 짝수): g2 RW, g4 QE, g6 EQ, g8 RR, g10 QW, g12 EW
--       패배(g 홀수): g1 EE, g3 ER, g5 QQ, g7 QR, g9 RE, g11 RQ  (홀수 게임은 뒤에 WQ를 붙여 13자)
--       손 계산: pick 모두 1 → win 내림(승리 6개) → 문자열 오름차순
--         1~6위  승리 EQ, EW, QE, QW, RR, RW
--         7~10위 패배 EE, ER, QQ, QR   /  RE, RQ 는 11·12위로 제외
--   s2  챔피언 32 JUNGLE. g1 EQQWQRQEQEREEW(14), g2 EQQWQRQEQERWW(13), g3 EQQWQRQEQER(11)
--       → EQQWQRQEQER pick 3 win 1 (g2만 승리). g4 EQQWQRQEQE(10자) 제외, g5 '' 제외, 나머지 NULL
--   s3  챔피언 33 포지션 NULL, skill_order = EQQWQRQEQER → 집계되지 않음
--   s4~s10 챔피언 100+s, 포지션 고정, skill_order NULL
DO $$
DECLARE
  v_res jsonb;
  v_got text;
  v_n int;
  v_bad text;
BEGIN
  INSERT INTO matches (match_id, puuid, patch, game_start_at)
  SELECT 'KR_9300000' || lpad(g::text, 3, '0'), NULL, '0.3', timestamptz '2021-01-10 00:00:00+00'
  FROM generate_series(1, 12) AS g;

  INSERT INTO match_players
  SELECT
    'KR_9300000' || lpad(g::text, 3, '0'),
    'g' || g || '-p' || s,
    CASE s WHEN 1 THEN 31 WHEN 2 THEN 32 WHEN 3 THEN 33 ELSE 100 + s END,
    CASE s WHEN 1 THEN 'TOP' WHEN 2 THEN 'JUNGLE' WHEN 3 THEN NULL
           WHEN 4 THEN 'BOTTOM' WHEN 5 THEN 'UTILITY' WHEN 6 THEN 'TOP' WHEN 7 THEN 'JUNGLE'
           WHEN 8 THEN 'MIDDLE' WHEN 9 THEN 'BOTTOM' ELSE 'UTILITY' END,
    CASE WHEN s <= 5 THEN g % 2 = 0 ELSE g % 2 = 1 END,
    NULL,
    14, 4,
    8100, 9923, 8143, 8140, 8135, 8000, 8299, 9104, 5008, 5008, 5011,
    1018, 0, 0, 0, 0, 0,
    CASE
      WHEN s = 1 THEN 'QQQQQEEEE'
        || (ARRAY['EE','RW','ER','QE','QQ','EQ','QR','RR','RE','QW','RQ','EW'])[g]
        || CASE WHEN g % 2 = 1 THEN 'WQ' ELSE '' END
      WHEN s = 2 THEN (ARRAY['EQQWQRQEQEREEW','EQQWQRQEQERWW','EQQWQRQEQER','EQQWQRQEQE','',
                             NULL,NULL,NULL,NULL,NULL,NULL,NULL])[g]
      WHEN s = 3 THEN 'EQQWQRQEQER'
    END
  FROM generate_series(1, 12) AS g, generate_series(1, 10) AS s;

  v_res := refresh_window_stats(14, '2021-01-15 00:00:00+00');
  RAISE NOTICE '[결과] refresh_window_stats(14, ''2021-01-15+00'') = %', v_res;
  IF (v_res->>'games')::int <> 12 OR (v_res->>'skill_rows')::int <> 11 THEN
    RAISE EXCEPTION '반환값 불일치 (games 12, skill_rows 11 기대): %', v_res;
  END IF;

  -- 상위 10개 + 동률 순서
  SELECT string_agg(substr(skill_order, 10, 2) || ' ' || pick || '/' || win, ', ' ORDER BY skill_order)
    INTO v_got
  FROM champion_skill WHERE champion_id = 31 AND position = 'TOP';
  IF v_got IS DISTINCT FROM 'EE 1/0, EQ 1/1, ER 1/0, EW 1/1, QE 1/1, QQ 1/0, QR 1/0, QW 1/1, RR 1/1, RW 1/1' THEN
    RAISE EXCEPTION 'champion_skill 31 TOP 상위 10개 불일치: %', v_got;
  END IF;
  IF EXISTS (SELECT 1 FROM champion_skill WHERE champion_id = 31
             AND skill_order IN ('QQQQQEEEERE', 'QQQQQEEEERQ')) THEN
    RAISE EXCEPTION '11·12위(RE, RQ)가 저장됨';
  END IF;
  IF EXISTS (SELECT 1 FROM champion_skill WHERE length(skill_order) <> 11) THEN
    RAISE EXCEPTION '11자가 아닌 skill_order가 저장됨';
  END IF;
  RAISE NOTICE '[통과] 상위 10개: 승리 6개(EQ EW QE QW RR RW) + 패배 중 문자열 순 4개(EE ER QQ QR), RE·RQ 제외, 13자 → 앞 11자';

  -- 같은 앞 11글자 묶기 + 경계
  SELECT string_agg(skill_order || ' ' || pick || '/' || win, ', ' ORDER BY skill_order) INTO v_got
  FROM champion_skill WHERE champion_id = 32 AND position = 'JUNGLE';
  IF v_got IS DISTINCT FROM 'EQQWQRQEQER 3/1' THEN
    RAISE EXCEPTION 'champion_skill 32 JUNGLE 불일치: %', v_got;
  END IF;
  RAISE NOTICE '[통과] 14자·13자·11자 → EQQWQRQEQER pick 3 win 1 한 줄, 10자·빈 문자열·NULL 제외';

  IF EXISTS (SELECT 1 FROM champion_skill WHERE champion_id = 33)
     OR EXISTS (SELECT 1 FROM champion_skill WHERE champion_id > 100) THEN
    RAISE EXCEPTION '포지션 NULL 줄 또는 skill_order NULL 줄이 집계됨';
  END IF;
  RAISE NOTICE '[통과] 포지션 NULL 줄(챔피언 33), skill_order NULL 줄(챔피언 104~110) 제외';

  -- CHECK 거부 (23514)
  FOREACH v_bad IN ARRAY ARRAY['Q>E>W', 'EQQWQRQEQE', 'EQQWQRQEQERE', 'EQQWQRQEQEX'] LOOP
    BEGIN
      INSERT INTO champion_skill (champion_id, position, skill_order, pick, win)
      VALUES (31, 'TOP', v_bad, 1, 0);
      RAISE EXCEPTION 'champion_skill.skill_order = % 이 허용됨', v_bad;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  INSERT INTO champion_skill (champion_id, position, skill_order, pick, win)
  VALUES (31, 'TOP', 'WWWWWWWWWWW', 1, 0);
  RAISE NOTICE '[통과] CHECK: Q>E>W, 10자, 12자, X 포함 → 23514 거부 4건, 11자 WWWWWWWWWWW 허용';

  -- 구조
  SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY ordinal_position) INTO v_got
  FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'champion_skill';
  IF v_got IS DISTINCT FROM 'champion_id:integer:NO,position:text:NO,skill_order:text:NO,pick:integer:NO,win:integer:NO' THEN
    RAISE EXCEPTION 'champion_skill 컬럼 불일치: %', v_got;
  END IF;
  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO v_got
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'champion_skill'::regclass AND c.conname = 'champion_skill_pkey' AND c.contype = 'p';
  IF v_got IS DISTINCT FROM 'champion_id,position,skill_order' THEN
    RAISE EXCEPTION 'champion_skill_pkey 컬럼 불일치: %', v_got;
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint
  WHERE conrelid = 'champion_skill'::regclass AND conname = 'champion_skill_skill_priority_check';
  IF v_n <> 0 THEN RAISE EXCEPTION '예전 CHECK champion_skill_skill_priority_check 가 남아 있음'; END IF;
  SELECT pg_get_constraintdef(oid) INTO v_got FROM pg_constraint
  WHERE conrelid = 'champion_skill'::regclass AND conname = 'champion_skill_skill_order_check';
  IF v_got IS NULL OR v_got NOT LIKE '%^[QWER]{11}$%' THEN
    RAISE EXCEPTION 'champion_skill_skill_order_check 불일치: %', v_got;
  END IF;
  RAISE NOTICE '[통과] 구조: 컬럼 5개(skill_order 포함, skill_priority·patch 없음), PK (champion_id, position, skill_order), CHECK %', v_got;

  -- 함수 삭제 (D6 (a))
  IF to_regprocedure('skill_priority(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'skill_priority(text) 함수가 남아 있음';
  END IF;
  RAISE NOTICE '[통과] skill_priority(text) 함수 없음';
END $$;
