-- 012: 룬 보조 2개 정렬 (db_spec 변경 04, 마이그레이션 016). 샘플 패치 '0.9', 시작 2021-01-10, 항상 ROLLBACK.
-- 순서: (1) 실제 데이터 검사(stats_window가 있을 때만, 같은 창으로 재집계 후 원본에서 따로 계산한 상위 10개와 EXCEPT 비교)
--       (2) 샘플 집계 refresh_window_stats(14, '2021-01-15+00') (창 [2021-01-01, 2021-01-15), 실제 데이터와 섞이지 않음)
--       (3) CHECK champion_rune_sub_perk_order_check 거부·통과, 제약 정의
--
-- 샘플 설계 (게임 g = 1~11 KR_9100000001~011, 참가자 s = 1~10, 1~5 = A팀, A팀 승리 = g1, g2, g5, g9)
--   s1  챔피언 23 TOP. 핵심 트리 8000 (8010, 9111, 9104, 8299), 보조 트리 8400, 파편 5008/5008/5001
--       g1~4  보조 (8453, 8473)                         승리 g1, g2
--       g5~7  보조 (8473, 8453)  ← 누른 순서만 뒤집힘    승리 g5
--       g8~9  보조 (8444, 8453)                         승리 g9
--       g10   g1과 같고 primary_perk2·primary_perk3만 서로 바꿈 (9104, 9111) → 별도 페이지
--       g11   보조 (8453, 8453) (게임에서 나올 수 없는 값) → 룬 집계에서 빠짐, champion pick에는 포함
--       손 계산: 23 TOP 룬 3줄 = (8453, 8473) 7/3, (8444, 8453) 2/1, 핵심 룬 바뀐 (8453, 8473) 1/0. champion 23 TOP 11/4
--   s2~s10 챔피언 100+s, 포지션 고정, 룬 고정 (8100 / 9923 8143 8140 8135 / 8000 8299 9104 / 5008 5008 5011)
DO $$
DECLARE
  w record;
  v_res jsonb;
  v_got text;
  v_n int;
  v_con text;
BEGIN
  -- (1) 실제 데이터 (롤백 안에서 같은 창으로 재집계)
  SELECT * INTO w FROM stats_window;
  IF NOT FOUND THEN
    RAISE NOTICE '[건너뜀] stats_window 없음 (빈 스키마): 실제 데이터 검사';
  ELSE
    v_res := refresh_window_stats(w.days, w.window_end);
    RAISE NOTICE '[결과] 실제 창 재집계 refresh_window_stats(%, %) games %, rune_rows %',
      w.days, w.window_end, v_res->>'games', v_res->>'rune_rows';

    CREATE TEMP TABLE t012_expected ON COMMIT DROP AS
    SELECT champion_id, team_position AS position,
           primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
           sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense, pick, win
    FROM (
      SELECT x.*,
             row_number() OVER (
               PARTITION BY x.champion_id, x.team_position
               ORDER BY x.pick DESC, x.win DESC,
                        x.primary_style, x.primary_perk1, x.primary_perk2, x.primary_perk3, x.primary_perk4,
                        x.sub_style, x.sub_perk1, x.sub_perk2, x.stat_offense, x.stat_flex, x.stat_defense
             ) AS rn
      FROM (
        SELECT mp.champion_id, mp.team_position,
               mp.primary_style, mp.primary_perk1, mp.primary_perk2, mp.primary_perk3, mp.primary_perk4,
               mp.sub_style,
               least(mp.sub_perk1, mp.sub_perk2) AS sub_perk1,
               greatest(mp.sub_perk1, mp.sub_perk2) AS sub_perk2,
               mp.stat_offense, mp.stat_flex, mp.stat_defense,
               count(*)::int AS pick, (count(*) FILTER (WHERE mp.win))::int AS win
        FROM match_players mp
        WHERE mp.team_position IS NOT NULL
          AND mp.sub_perk1 <> mp.sub_perk2
          AND mp.match_id IN (
            SELECT m.match_id FROM matches m JOIN match_players p ON p.match_id = m.match_id
            WHERE m.game_start_at >= w.window_start AND m.game_start_at < w.window_end
            GROUP BY m.match_id HAVING count(*) = 10)
        GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13
      ) x
    ) y
    WHERE rn <= 10;

    SELECT count(*) INTO v_n FROM (
      (SELECT champion_id, position, primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
              sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense, pick, win FROM champion_rune
       EXCEPT SELECT * FROM t012_expected)
      UNION ALL
      (SELECT * FROM t012_expected
       EXCEPT SELECT champion_id, position, primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
              sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense, pick, win FROM champion_rune)
    ) d;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '실제 데이터: champion_rune과 원본 직접 계산(least/greatest 상위 10개)의 차이 %줄', v_n;
    END IF;
    IF (SELECT count(*) FROM champion_rune) <> (v_res->>'rune_rows')::int THEN
      RAISE EXCEPTION '실제 데이터: champion_rune 줄 수와 rune_rows 불일치';
    END IF;

    -- 1순위와 2순위가 순서만 다른 같은 페이지인 챔피언 × 포지션
    WITH q AS (
      SELECT r.*, row_number() OVER (PARTITION BY champion_id, position
                                     ORDER BY pick DESC, win DESC, primary_style, primary_perk1, primary_perk2,
                                              primary_perk3, primary_perk4, sub_style, sub_perk1, sub_perk2,
                                              stat_offense, stat_flex, stat_defense) AS rn
      FROM champion_rune r)
    SELECT count(*) INTO v_n
    FROM q a JOIN q b ON a.champion_id = b.champion_id AND a.position = b.position AND a.rn = 1 AND b.rn = 2
    WHERE (a.primary_style, a.primary_perk1, a.primary_perk2, a.primary_perk3, a.primary_perk4, a.sub_style,
           least(a.sub_perk1, a.sub_perk2), greatest(a.sub_perk1, a.sub_perk2), a.stat_offense, a.stat_flex, a.stat_defense)
        = (b.primary_style, b.primary_perk1, b.primary_perk2, b.primary_perk3, b.primary_perk4, b.sub_style,
           least(b.sub_perk1, b.sub_perk2), greatest(b.sub_perk1, b.sub_perk2), b.stat_offense, b.stat_flex, b.stat_defense);
    IF v_n <> 0 THEN RAISE EXCEPTION '실제 데이터: 1순위 = 2순위인 챔피언 × 포지션 %개', v_n; END IF;

    SELECT count(*) INTO v_n
    FROM champion_rune a JOIN champion_rune b
      ON a.champion_id = b.champion_id AND a.position = b.position
     AND a.primary_style = b.primary_style AND a.primary_perk1 = b.primary_perk1 AND a.primary_perk2 = b.primary_perk2
     AND a.primary_perk3 = b.primary_perk3 AND a.primary_perk4 = b.primary_perk4 AND a.sub_style = b.sub_style
     AND a.sub_perk1 = b.sub_perk2 AND a.sub_perk2 = b.sub_perk1
     AND a.stat_offense = b.stat_offense AND a.stat_flex = b.stat_flex AND a.stat_defense = b.stat_defense;
    IF v_n <> 0 THEN RAISE EXCEPTION '실제 데이터: 순서만 다른 쌍 %개', v_n; END IF;
    IF EXISTS (SELECT 1 FROM champion_rune WHERE sub_perk1 >= sub_perk2) THEN
      RAISE EXCEPTION '실제 데이터: sub_perk1 >= sub_perk2 줄 있음';
    END IF;
    RAISE NOTICE '[통과] 실제 데이터: 직접 계산과 EXCEPT 양방향 0줄, 1순위 = 2순위 0개, 순서만 다른 쌍 0개, sub_perk1 < sub_perk2 (rune_rows %)',
      v_res->>'rune_rows';
  END IF;

  -- (2) 샘플
  INSERT INTO matches (match_id, puuid, patch, game_start_at)
  SELECT 'KR_9100000' || lpad(g::text, 3, '0'), NULL, '0.9', timestamptz '2021-01-10 00:00:00+00'
  FROM generate_series(1, 11) AS g;

  INSERT INTO match_players
  SELECT
    'KR_9100000' || lpad(g::text, 3, '0'),
    'g' || g || '-p' || s,
    CASE s WHEN 1 THEN 23 ELSE 100 + s END,
    CASE s WHEN 1 THEN 'TOP' WHEN 2 THEN 'JUNGLE' WHEN 3 THEN 'MIDDLE' WHEN 4 THEN 'BOTTOM' WHEN 5 THEN 'UTILITY'
           WHEN 6 THEN 'TOP' WHEN 7 THEN 'JUNGLE' WHEN 8 THEN 'MIDDLE' WHEN 9 THEN 'BOTTOM' ELSE 'UTILITY' END,
    CASE WHEN s <= 5 THEN g IN (1, 2, 5, 9) ELSE g NOT IN (1, 2, 5, 9) END,
    NULL,
    14, 4,
    -- 핵심 트리, 핵심 룬 4개
    CASE WHEN s = 1 THEN 8000 ELSE 8100 END,
    CASE WHEN s = 1 THEN 8010 ELSE 9923 END,
    CASE WHEN s = 1 THEN CASE WHEN g = 10 THEN 9104 ELSE 9111 END ELSE 8143 END,
    CASE WHEN s = 1 THEN CASE WHEN g = 10 THEN 9111 ELSE 9104 END ELSE 8140 END,
    CASE WHEN s = 1 THEN 8299 ELSE 8135 END,
    -- 보조 트리, 보조 룬 2개 (누른 순서)
    CASE WHEN s = 1 THEN 8400 ELSE 8000 END,
    CASE WHEN s <> 1 THEN 8299
         WHEN g <= 4 OR g = 10 THEN 8453 WHEN g <= 7 THEN 8473 WHEN g <= 9 THEN 8444 ELSE 8453 END,
    CASE WHEN s <> 1 THEN 9104
         WHEN g <= 4 OR g = 10 THEN 8473 WHEN g <= 7 THEN 8453 WHEN g <= 9 THEN 8453 ELSE 8453 END,
    -- 파편
    5008, 5008, CASE WHEN s = 1 THEN 5001 ELSE 5011 END,
    1018, 0, 0, 0, 0, 0,
    NULL
  FROM generate_series(1, 11) AS g, generate_series(1, 10) AS s;

  v_res := refresh_window_stats(14, '2021-01-15 00:00:00+00');
  RAISE NOTICE '[결과] refresh_window_stats(14, ''2021-01-15+00'') = %', v_res;
  IF (v_res->>'games')::int <> 11 THEN
    RAISE EXCEPTION '샘플 games % <> 11', v_res->>'games';
  END IF;

  SELECT pick || '/' || win INTO v_got FROM champion WHERE champion_id = 23 AND position = 'TOP';
  IF v_got IS DISTINCT FROM '11/4' THEN
    RAISE EXCEPTION 'champion 23 TOP % (11/4 기대, 같은 보조 룬 줄도 pick에 포함)', v_got;
  END IF;

  SELECT string_agg(primary_perk2 || '-' || primary_perk3 || ' (' || sub_perk1 || ', ' || sub_perk2 || ') ' || pick || '/' || win,
                    ', ' ORDER BY pick DESC, win DESC, primary_perk2, sub_perk1)
    INTO v_got
  FROM champion_rune WHERE champion_id = 23 AND position = 'TOP';
  IF v_got IS DISTINCT FROM '9111-9104 (8453, 8473) 7/3, 9111-9104 (8444, 8453) 2/1, 9104-9111 (8453, 8473) 1/0' THEN
    RAISE EXCEPTION 'champion_rune 23 TOP 불일치: %', v_got;
  END IF;
  RAISE NOTICE '[통과] 두 순서 합치기 (8453, 8473) 7/3, 다른 조합 (8444, 8453) 2/1, 핵심 룬 칸 바뀐 페이지는 별도 1/0, 같은 보조 룬 줄 제외 (23 TOP 룬 3줄, champion pick 11)';

  SELECT sub_perk1 || ',' || sub_perk2 || ' ' || pick INTO v_got
  FROM champion_rune WHERE champion_id = 23 AND position = 'TOP'
  ORDER BY pick DESC, win DESC LIMIT 1;
  IF v_got IS DISTINCT FROM '8453,8473 7' THEN RAISE EXCEPTION '1순위 불일치: %', v_got; END IF;
  RAISE NOTICE '[통과] 1순위 (8453, 8473) pick 7';

  IF EXISTS (SELECT 1 FROM champion_rune WHERE sub_perk1 >= sub_perk2) THEN
    RAISE EXCEPTION '샘플: sub_perk1 >= sub_perk2 줄 있음';
  END IF;
  SELECT count(*) INTO v_n
  FROM champion_rune a JOIN champion_rune b
    ON a.champion_id = b.champion_id AND a.position = b.position
   AND a.primary_style = b.primary_style AND a.primary_perk1 = b.primary_perk1 AND a.primary_perk2 = b.primary_perk2
   AND a.primary_perk3 = b.primary_perk3 AND a.primary_perk4 = b.primary_perk4 AND a.sub_style = b.sub_style
   AND a.sub_perk1 = b.sub_perk2 AND a.sub_perk2 = b.sub_perk1
   AND a.stat_offense = b.stat_offense AND a.stat_flex = b.stat_flex AND a.stat_defense = b.stat_defense;
  IF v_n <> 0 THEN RAISE EXCEPTION '샘플: 순서만 다른 쌍 %개', v_n; END IF;
  RAISE NOTICE '[통과] 샘플 전체: sub_perk1 < sub_perk2, 순서만 다른 쌍 0개';

  -- (3) CHECK
  BEGIN
    INSERT INTO champion_rune (champion_id, position, primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
                               sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense, pick, win)
    VALUES (23, 'TOP', 8100, 9923, 8143, 8140, 8135, 8400, 8473, 8453, 5008, 5008, 5001, 1, 0);
    RAISE EXCEPTION '(8473, 8453)이 거부되지 않음';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'champion_rune_sub_perk_order_check' THEN RAISE EXCEPTION '다른 CHECK로 거부: %', v_con; END IF;
  END;
  BEGIN
    INSERT INTO champion_rune (champion_id, position, primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
                               sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense, pick, win)
    VALUES (23, 'TOP', 8100, 9923, 8143, 8140, 8135, 8400, 8453, 8453, 5008, 5008, 5001, 1, 0);
    RAISE EXCEPTION '(8453, 8453)이 거부되지 않음';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    IF v_con <> 'champion_rune_sub_perk_order_check' THEN RAISE EXCEPTION '다른 CHECK로 거부: %', v_con; END IF;
  END;
  INSERT INTO champion_rune (champion_id, position, primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
                             sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense, pick, win)
  VALUES (23, 'TOP', 8100, 9923, 8143, 8140, 8135, 8400, 8453, 8474, 5008, 5008, 5001, 1, 0);
  RAISE NOTICE '[통과] CHECK: (8473, 8453)·(8453, 8453) 23514 거부, (8453, 8474) 통과';

  SELECT pg_get_constraintdef(c.oid) || ' / ' || c.convalidated INTO v_got
  FROM pg_constraint c
  WHERE c.conrelid = 'champion_rune'::regclass AND c.conname = 'champion_rune_sub_perk_order_check';
  IF v_got IS DISTINCT FROM 'CHECK ((sub_perk1 < sub_perk2)) / true' THEN
    RAISE EXCEPTION '제약 정의 불일치: %', coalesce(v_got, '없음');
  END IF;
  RAISE NOTICE '[통과] 제약 정의 %', v_got;
END $$;
