-- 003: refresh_patch_stats (db_spec 8-5). 샘플 패치 '0.1', 항상 ROLLBACK.
--
-- 샘플 설계 (게임 g = 1~20, 참가자 s = 1~10, 1~5 = A팀, 6~10 = B팀, A팀 승리 = g <= 12)
--   s1  챔피언 23  TOP. 밴 64. 스펠 g 홀수 14/4, 짝수 4/14.
--       아이템 g <= 10: 1018 3074 3006 3046 1036 1036, g > 10: 1018 0 0 0 0 0
--       스킬 (변경 01, 앞 11글자): g <= 15: EQQWQRQEQEREEW(14자 → EQQWQRQEQER), 16~17: QWEQWE(6자, 제외),
--            18: WEWEWEWEWE(10자 경계, 제외), 19: WEWEWEWEWER(11자 경계, 그대로), 20: WEWEWEWEWERQQ(13자 → WEWEWEWEWER)
--       룬 g <= 9: 같은 페이지(perk1 9923), g >= 10: 페이지 11개(perk1 9000+g)
--   s2  챔피언 64  g <= 14 JUNGLE, 그 외 MIDDLE
--   s3  챔피언 99  g <= 3 포지션 NULL(이때 23 밴), 그 외 MIDDLE
--   s4~s10 챔피언 100+s, 포지션 고정. s6은 g <= 5에서 64 밴 (양 팀이 같은 챔피언 밴)
--   추가: KR_9000000021 (패치 0.1, 9줄 → 제외), KR_9000000022 (패치 0.2, 10줄 → 다른 패치)
DO $$
DECLARE
  v_res1 jsonb;
  v_res2 jsonb;
  v_snap1 text;
  v_snap2 text;
  r record;
  v_n int;
BEGIN
  INSERT INTO matches (match_id, puuid, patch)
  SELECT 'KR_9000000' || lpad(g::text, 3, '0'), NULL, CASE WHEN g = 22 THEN '0.2' ELSE '0.1' END
  FROM generate_series(1, 22) AS g;

  INSERT INTO match_players
  SELECT
    'KR_9000000' || lpad(g::text, 3, '0'),
    'g' || g || '-p' || s,
    CASE s WHEN 1 THEN 23 WHEN 2 THEN 64 WHEN 3 THEN 99 ELSE 100 + s END,
    CASE s WHEN 1 THEN 'TOP'
           WHEN 2 THEN CASE WHEN g <= 14 THEN 'JUNGLE' ELSE 'MIDDLE' END
           WHEN 3 THEN CASE WHEN g <= 3 THEN NULL ELSE 'MIDDLE' END
           WHEN 4 THEN 'BOTTOM' WHEN 5 THEN 'UTILITY' WHEN 6 THEN 'TOP' WHEN 7 THEN 'JUNGLE'
           WHEN 8 THEN 'MIDDLE' WHEN 9 THEN 'BOTTOM' ELSE 'UTILITY' END,
    CASE WHEN s <= 5 THEN g <= 12 ELSE g > 12 END,
    CASE WHEN s = 1 THEN 64 WHEN s = 6 AND g <= 5 THEN 64 WHEN s = 3 AND g <= 3 THEN 23 END,
    CASE WHEN s = 1 AND g % 2 = 0 THEN 4 ELSE 14 END,
    CASE WHEN s = 1 AND g % 2 = 0 THEN 14 ELSE 4 END,
    8100, CASE WHEN s = 1 AND g >= 10 THEN 9000 + g ELSE 9923 END, 8143, 8140, 8135,
    8000, 8299, 9104, 5008, 5008, 5011,
    CASE WHEN s = 1 THEN 1018 ELSE 0 END,
    CASE WHEN s = 1 AND g <= 10 THEN 3074 ELSE 0 END,
    CASE WHEN s = 1 AND g <= 10 THEN 3006 ELSE 0 END,
    CASE WHEN s = 1 AND g <= 10 THEN 3046 ELSE 0 END,
    CASE WHEN s = 1 AND g <= 10 THEN 1036 ELSE 0 END,
    CASE WHEN s = 1 AND g <= 10 THEN 1036 ELSE 0 END,
    CASE WHEN s <> 1 THEN NULL
         WHEN g <= 15 THEN 'EQQWQRQEQEREEW'
         WHEN g <= 17 THEN 'QWEQWE'
         WHEN g = 18 THEN 'WEWEWEWEWE'
         WHEN g = 19 THEN 'WEWEWEWEWER'
         ELSE 'WEWEWEWEWERQQ' END
  FROM generate_series(1, 20) AS g, generate_series(1, 10) AS s;

  -- 9줄짜리 게임 (패치 0.1, 제외되어야 함)
  INSERT INTO match_players
  SELECT 'KR_9000000021', 'g21-p' || s, 555, 'TOP', s <= 5, NULL, 14, 4,
         8100, 9923, 8143, 8140, 8135, 8000, 8299, 9104, 5008, 5008, 5011, 1018, 0, 0, 0, 0, 0, NULL
  FROM generate_series(1, 9) AS s;
  -- 다른 패치 게임 (패치 0.2, 10줄)
  INSERT INTO match_players
  SELECT 'KR_9000000022', 'g22-p' || s, 556, 'TOP', s <= 5, 23, 14, 4,
         8100, 9923, 8143, 8140, 8135, 8000, 8299, 9104, 5008, 5008, 5011, 1018, 0, 0, 0, 0, 0, NULL
  FROM generate_series(1, 10) AS s;

  -- 1차 집계
  v_res1 := refresh_patch_stats('0.1');
  RAISE NOTICE '[결과] refresh_patch_stats(''0.1'') = %', v_res1;
  IF v_res1 <> '{"patch":"0.1","games":20,"champion_rows":11,"item_rows":5,"rune_rows":20,"spell_rows":11,"skill_rows":2}'::jsonb THEN
    RAISE EXCEPTION '반환값 불일치: %', v_res1;
  END IF;

  -- patch.games = 10줄 게임 수 (9줄 게임·다른 패치 제외)
  SELECT games INTO v_n FROM patch WHERE patch = '0.1';
  IF v_n <> 20 THEN RAISE EXCEPTION 'patch.games = %, 기대 20', v_n; END IF;
  IF EXISTS (SELECT 1 FROM champion WHERE patch = '0.1' AND champion_id IN (555, 556)) THEN
    RAISE EXCEPTION '9줄 게임 또는 다른 패치 게임이 집계됨';
  END IF;
  RAISE NOTICE '[통과] patch.games = 20 (9줄 게임, 다른 패치 게임 제외)';

  -- champion pick / win / ban
  FOR r IN
    SELECT * FROM (VALUES
      (23,  'TOP',    20, 12, 3),   -- ban 3: 포지션 NULL 줄(s3, g <= 3)의 밴도 포함
      (64,  'JUNGLE', 14, 12, 20),  -- ban 20: g <= 5 에서 양 팀이 64를 밴해도 게임당 1번
      (64,  'MIDDLE',  6,  0, 20),  -- 같은 챔피언의 모든 포지션에 같은 ban
      (99,  'MIDDLE', 17,  9, 0),   -- 포지션 NULL 3줄은 pick 에서 빠짐
      (106, 'TOP',    20,  8, 0)
    ) AS t(champion_id, position, pick, win, ban)
  LOOP
    PERFORM 1 FROM champion c
    WHERE c.patch = '0.1' AND c.champion_id = r.champion_id AND c.position = r.position
      AND c.pick = r.pick AND c.win = r.win AND c.ban = r.ban;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'champion % % 불일치: 기대 pick % win % ban %, 실제 %', r.champion_id, r.position, r.pick, r.win, r.ban,
        (SELECT row_to_json(c) FROM champion c WHERE c.patch = '0.1' AND c.champion_id = r.champion_id AND c.position = r.position);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM champion WHERE patch = '0.1' AND champion_id = 777) THEN
    RAISE EXCEPTION '픽 없는 챔피언 줄이 생김';
  END IF;
  RAISE NOTICE '[통과] champion: 23 TOP 20/12/3, 64 JUNGLE 14/12/20, 64 MIDDLE 6/0/20, 99 MIDDLE 17/9/0, 106 TOP 20/8/0';

  -- champion_item: 0 제외, 한 줄 안 1036 1036 → 1번
  SELECT count(*) INTO v_n FROM champion_item WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP';
  IF v_n <> 5 THEN RAISE EXCEPTION 'champion_item 23 TOP 줄 수 = %, 기대 5', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM champion_item WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP' AND item_id = 1036 AND pick = 10 AND win = 10)
  OR NOT EXISTS (SELECT 1 FROM champion_item WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP' AND item_id = 1018 AND pick = 20 AND win = 12)
  OR NOT EXISTS (SELECT 1 FROM champion_item WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP' AND item_id = 3074 AND pick = 10 AND win = 10)
  THEN
    RAISE EXCEPTION 'champion_item 값 불일치';
  END IF;
  IF EXISTS (SELECT 1 FROM champion_item WHERE item_id = 0) THEN RAISE EXCEPTION 'item_id 0 이 집계됨'; END IF;
  RAISE NOTICE '[통과] champion_item: 23 TOP 5줄, 1036 pick 10 (중복 1번), 1018 pick 20 win 12, 0 제외';

  -- champion_spell: 14/4 와 4/14 → (4, 14) 한 조합
  SELECT count(*) INTO v_n FROM champion_spell WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP';
  IF v_n <> 1 OR NOT EXISTS (
    SELECT 1 FROM champion_spell WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP'
      AND spell1_id = 4 AND spell2_id = 14 AND pick = 20 AND win = 12) THEN
    RAISE EXCEPTION 'champion_spell 23 TOP 불일치 (줄 수 %)', v_n;
  END IF;
  RAISE NOTICE '[통과] champion_spell: 14/4 + 4/14 → (4, 14) pick 20 win 12, 1줄';

  -- champion_rune: 페이지 12개 → 상위 10개, 동률 정렬 고정
  SELECT count(*) INTO v_n FROM champion_rune WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP';
  IF v_n <> 10 THEN RAISE EXCEPTION 'champion_rune 23 TOP 줄 수 = %, 기대 10', v_n; END IF;
  IF (SELECT array_agg(primary_perk1 ORDER BY primary_perk1) FROM champion_rune
      WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP')
     <> ARRAY[9010, 9011, 9012, 9013, 9014, 9015, 9016, 9017, 9018, 9923] THEN
    RAISE EXCEPTION 'champion_rune 상위 10개 불일치: %', (SELECT array_agg(primary_perk1 ORDER BY primary_perk1) FROM champion_rune WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM champion_rune WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP' AND primary_perk1 = 9923 AND pick = 9 AND win = 9) THEN
    RAISE EXCEPTION 'champion_rune 1위 페이지 불일치';
  END IF;
  RAISE NOTICE '[통과] champion_rune: 페이지 12개 중 상위 10개 (9923 pick 9, 승리 동률 9010~9012, 패배 동률 9013~9018 / 9019·9020 제외)';

  -- champion_skill: 앞 11글자로 묶음, 10자 이하·NULL 제외 (변경 01)
  IF (SELECT string_agg(skill_order || ' ' || pick || '/' || win, ', ' ORDER BY skill_order)
      FROM champion_skill WHERE patch = '0.1' AND champion_id = 23 AND position = 'TOP')
     IS DISTINCT FROM 'EQQWQRQEQER 15/12, WEWEWEWEWER 2/0' THEN
    RAISE EXCEPTION 'champion_skill 불일치: %', (SELECT string_agg(skill_order || ' ' || pick || '/' || win, ', ' ORDER BY skill_order) FROM champion_skill WHERE patch = '0.1');
  END IF;
  RAISE NOTICE '[통과] champion_skill: EQQWQRQEQER 15/12, WEWEWEWEWER 2/0 (6자 2줄·10자 1줄 제외, 11자·13자 → 같은 줄)';

  -- 같은 패치를 두 번 집계 → 결과 같음, 중복 오류 없음
  SELECT string_agg(x, '|' ORDER BY x) INTO v_snap1 FROM (
    SELECT 'c' || row(c.*)::text AS x FROM champion c WHERE patch = '0.1'
    UNION ALL SELECT 'i' || row(i.*)::text FROM champion_item i WHERE patch = '0.1'
    UNION ALL SELECT 'r' || row(cr.patch, cr.champion_id, cr.position, cr.primary_style, cr.primary_perk1, cr.primary_perk2, cr.primary_perk3, cr.primary_perk4, cr.sub_style, cr.sub_perk1, cr.sub_perk2, cr.stat_offense, cr.stat_flex, cr.stat_defense, cr.pick, cr.win)::text FROM champion_rune cr WHERE patch = '0.1'
    UNION ALL SELECT 's' || row(s.*)::text FROM champion_spell s WHERE patch = '0.1'
    UNION ALL SELECT 'k' || row(k.*)::text FROM champion_skill k WHERE patch = '0.1'
  ) t;
  v_res2 := refresh_patch_stats('0.1');
  SELECT string_agg(x, '|' ORDER BY x) INTO v_snap2 FROM (
    SELECT 'c' || row(c.*)::text AS x FROM champion c WHERE patch = '0.1'
    UNION ALL SELECT 'i' || row(i.*)::text FROM champion_item i WHERE patch = '0.1'
    UNION ALL SELECT 'r' || row(cr.patch, cr.champion_id, cr.position, cr.primary_style, cr.primary_perk1, cr.primary_perk2, cr.primary_perk3, cr.primary_perk4, cr.sub_style, cr.sub_perk1, cr.sub_perk2, cr.stat_offense, cr.stat_flex, cr.stat_defense, cr.pick, cr.win)::text FROM champion_rune cr WHERE patch = '0.1'
    UNION ALL SELECT 's' || row(s.*)::text FROM champion_spell s WHERE patch = '0.1'
    UNION ALL SELECT 'k' || row(k.*)::text FROM champion_skill k WHERE patch = '0.1'
  ) t;
  IF v_res1 <> v_res2 OR v_snap1 <> v_snap2 THEN
    RAISE EXCEPTION '두 번 집계한 결과가 다름';
  END IF;
  RAISE NOTICE '[통과] 같은 패치 2번 집계: 반환값·집계 % 줄 동일, 중복 오류 없음',
    (SELECT count(*) FROM champion WHERE patch = '0.1') + (SELECT count(*) FROM champion_item WHERE patch = '0.1')
    + (SELECT count(*) FROM champion_rune WHERE patch = '0.1') + (SELECT count(*) FROM champion_spell WHERE patch = '0.1')
    + (SELECT count(*) FROM champion_skill WHERE patch = '0.1');

  -- 원본이 없는 패치 → 오류, 기존 집계 그대로
  BEGIN
    PERFORM refresh_patch_stats('0.7');
    RAISE EXCEPTION '원본 없는 패치 집계가 오류 없이 끝남';
  EXCEPTION WHEN no_data_found THEN
    RAISE NOTICE '[통과] 원본 없는 패치 0.7 → 오류: %', SQLERRM;
  END;
  -- 0.1 원본을 지운 뒤 다시 집계 → 오류, 0.1 기존 집계는 남음
  DELETE FROM matches WHERE patch = '0.1';
  BEGIN
    PERFORM refresh_patch_stats('0.1');
    RAISE EXCEPTION '원본을 지운 패치 집계가 오류 없이 끝남';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  SELECT count(*) INTO v_n FROM champion WHERE patch = '0.1';
  IF v_n <> 11 OR (SELECT games FROM patch WHERE patch = '0.1') <> 20 THEN
    RAISE EXCEPTION '오류 뒤 기존 집계가 바뀜 (champion %줄)', v_n;
  END IF;
  RAISE NOTICE '[통과] 원본 삭제 후 0.1 재집계 → 오류, 기존 집계 유지 (patch.games 20, champion 11줄)';

  -- 패치 형식 오류
  BEGIN
    PERFORM refresh_patch_stats('16.19.1');
    RAISE EXCEPTION '잘못된 패치 형식이 허용됨';
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE '[통과] 패치 형식 오류 16.19.1 → 거부';
  END;
END $$;
