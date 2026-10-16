-- 004: champion_tier_view (db_spec 7-6, 8-5, 변경 03). stats_window(games 1000) 1줄과 champion 6줄을 직접 넣는다. 항상 ROLLBACK.
-- 실제 스냅숏이 있으면 먼저 지운다 (ROLLBACK으로 되돌아감).
--
-- 손 계산 (보정 승률 = 100 × (win + 50) / (pick + 100), 점수 = 보정 + 0.10 × least(픽률, 20) + 0.03 × least(밴률, 30))
--   1 TOP     pick 49  win 30  ban 0    → 80/149 = 53.691…, 픽률 4.9 → +0.49      → 54.181, pick < 50 → tier NULL
--   2 TOP     pick 50  win 30  ban 0    → 80/150 = 53.333…, 픽률 5 → +0.5         → 53.833 → 1
--   3 JUNGLE  pick 300 win 150 ban 400  → 50.0, 픽률 30 → 상한 20 → +2.0, 밴률 40 → 상한 30 → +0.9 → 52.900 → 2
--   6 UTILITY pick 100 win 50  ban 0    → 50.0, 픽률 10 → +1.0                     → 51.000 → 3
--   4 MIDDLE  pick 100 win 47  ban 0    → 48.5, +1.0                               → 49.500 → 4
--   5 BOTTOM  pick 100 win 40  ban 10   → 45.0, +1.0, 밴률 1 → +0.03               → 46.030 → 5
DO $$
DECLARE
  r record;
  v record;
BEGIN
  DELETE FROM champion WHERE true;
  DELETE FROM stats_window WHERE true;

  -- 구조: 뷰에 patch 컬럼이 없음
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'champion_tier_view' AND column_name = 'patch') THEN
    RAISE EXCEPTION 'champion_tier_view에 patch 컬럼이 남아 있음';
  END IF;
  RAISE NOTICE '[통과] 뷰 컬럼: %', (SELECT string_agg(column_name, ',' ORDER BY ordinal_position)
    FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'champion_tier_view');

  INSERT INTO champion (champion_id, position, pick, win, ban) VALUES
    (1, 'TOP',     49,  30, 0),
    (2, 'TOP',     50,  30, 0),
    (3, 'JUNGLE',  300, 150, 400),
    (6, 'UTILITY', 100, 50, 0),
    (4, 'MIDDLE',  100, 47, 0),
    (5, 'BOTTOM',  100, 40, 10);

  -- stats_window 0줄이면 뷰도 0줄
  IF EXISTS (SELECT 1 FROM champion_tier_view) THEN
    RAISE EXCEPTION 'stats_window 0줄인데 뷰에 줄이 있음';
  END IF;
  RAISE NOTICE '[통과] stats_window 0줄 → 뷰 0줄';

  INSERT INTO stats_window (id, days, window_start, window_end, games)
  VALUES (1, 14, '2021-01-01 00:00:00+00', '2021-01-15 00:00:00+00', 1000);

  FOR r IN
    SELECT * FROM (VALUES
      (1, 61.22::numeric, 4.90::numeric, 0.00::numeric, 53.69::numeric, 54.181::numeric, NULL::smallint),
      (2, 60.00, 5.00, 0.00, 53.33, 53.833, 1::smallint),
      (3, 50.00, 30.00, 40.00, 50.00, 52.900, 2::smallint),
      (6, 50.00, 10.00, 0.00, 50.00, 51.000, 3::smallint),
      (4, 47.00, 10.00, 0.00, 48.50, 49.500, 4::smallint),
      (5, 40.00, 10.00, 1.00, 45.00, 46.030, 5::smallint)
    ) AS t(champion_id, win_rate, pick_rate, ban_rate, adjusted_win_rate, tier_score, tier)
  LOOP
    SELECT * INTO v FROM champion_tier_view WHERE champion_id = r.champion_id;
    IF v.win_rate <> r.win_rate OR v.pick_rate <> r.pick_rate OR v.ban_rate <> r.ban_rate
       OR v.adjusted_win_rate <> r.adjusted_win_rate OR v.tier_score <> r.tier_score
       OR v.tier IS DISTINCT FROM r.tier OR v.games <> 1000 THEN
      RAISE EXCEPTION 'champion_tier_view 챔피언 % 불일치: 실제 %', r.champion_id, row_to_json(v);
    END IF;
    RAISE NOTICE '[통과] 챔피언 % % pick % → 승률 % 픽률 % 밴률 % 보정 % 점수 % 티어 %',
      r.champion_id, v.position, v.pick, v.win_rate, v.pick_rate, v.ban_rate, v.adjusted_win_rate, v.tier_score, coalesce(v.tier::text, 'NULL');
  END LOOP;

  -- pick 49 / 50 경계 (같은 승률 조건에서)
  UPDATE champion SET pick = 50, win = 30 WHERE champion_id = 1;
  IF (SELECT tier FROM champion_tier_view WHERE champion_id = 1) IS NULL THEN
    RAISE EXCEPTION 'pick 50 인데 tier NULL';
  END IF;
  RAISE NOTICE '[통과] pick 49 → tier NULL, pick 50 → tier %', (SELECT tier FROM champion_tier_view WHERE champion_id = 1);

  -- 반올림 전 점수로 티어 계산: 점수 52.9996 은 tier_score 53.000 으로 보이지만 티어는 2
  -- pick 2000, games 10000: 픽률 20 → +2.0. 보정 승률이 50.9996이 되도록 win 을 정할 수 없으므로 tier_from_score로 직접 확인
  IF tier_from_score(52.9996) <> 2 OR round(52.9996::numeric, 3) <> 53.000 THEN
    RAISE EXCEPTION '반올림 전 점수 기준 확인 실패';
  END IF;
  RAISE NOTICE '[통과] 반올림 전 점수 52.9996 → 표시 53.000, 티어 2';

  -- 뷰 정렬 사용 예가 동작
  IF (SELECT array_agg(champion_id ORDER BY tier NULLS LAST, tier_score DESC)
      FROM champion_tier_view WHERE position IN ('TOP','JUNGLE','UTILITY','MIDDLE','BOTTOM')) IS NULL THEN
    RAISE EXCEPTION '뷰 정렬 조회 실패';
  END IF;
END $$;
