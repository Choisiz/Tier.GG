-- 009: refresh_window_stats 창 경계와 패치 구성 (db_spec 변경 03, 03-6). 항상 ROLLBACK.
--
-- p_until = 2021-01-15 00:00:00+00, p_days = 14 → 창 [2021-01-01 00:00, 2021-01-15 00:00)
--   게임 A 2021-01-01 00:00:00+00        (정확히 14일 전)  패치 0.5 → 포함 (시작 포함)
--   게임 B 2020-12-31 23:59:59.999999+00 (14일 + 1µs 전)   패치 0.5 → 제외
--   게임 C 2021-01-14 23:59:59+00                           패치 0.6 → 포함
--   게임 D 2021-01-15 00:00:00+00        (정확히 끝)       패치 0.6 → 제외 (끝 제외)
--   게임 E 2021-01-20 00:00:00+00        (끝보다 미래)     패치 0.6 → 제외
--   게임 F, G 2021-01-10                                    패치 0.6 → 포함
--   게임 H 2021-01-10, match_players 9줄                    패치 0.6 → 제외 (미완료)
-- 기대: games 4 (A, C, F, G), 구성 0.5 → 1, 0.6 → 3
-- 게임마다 참가자 10명: s1 챔피언 40 + 게임 번호 TOP (A 41, B 42, C 43, … H 48 → 어느 게임이 들어갔는지 확인), 나머지 100+s
DO $$
DECLARE
  v_res jsonb;
  v_got text;
  w record;
BEGIN
  INSERT INTO matches (match_id, puuid, patch, game_start_at) VALUES
    ('KR_9400000001', NULL, '0.5', '2021-01-01 00:00:00+00'),
    ('KR_9400000002', NULL, '0.5', '2020-12-31 23:59:59.999999+00'),
    ('KR_9400000003', NULL, '0.6', '2021-01-14 23:59:59+00'),
    ('KR_9400000004', NULL, '0.6', '2021-01-15 00:00:00+00'),
    ('KR_9400000005', NULL, '0.6', '2021-01-20 00:00:00+00'),
    ('KR_9400000006', NULL, '0.6', '2021-01-10 00:00:00+00'),
    ('KR_9400000007', NULL, '0.6', '2021-01-10 00:00:00+00'),
    ('KR_9400000008', NULL, '0.6', '2021-01-10 00:00:00+00');

  INSERT INTO match_players
  SELECT 'KR_940000000' || g, 'w' || g || '-p' || s,
         CASE WHEN s = 1 THEN 40 + g ELSE 100 + s END,
         (ARRAY['TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY','TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY'])[s],
         s <= 5, NULL, 14, 4,
         8100, 9923, 8143, 8140, 8135, 8000, 8299, 9104, 5008, 5008, 5011, 1018, 0, 0, 0, 0, 0, NULL
  FROM generate_series(1, 8) AS g, generate_series(1, 10) AS s
  WHERE NOT (g = 8 AND s = 10);   -- 게임 H는 9줄

  v_res := refresh_window_stats(14, '2021-01-15 00:00:00+00');
  RAISE NOTICE '[결과] refresh_window_stats(14, ''2021-01-15+00'') = %', v_res;

  -- stats_window
  SELECT * INTO w FROM stats_window;
  IF (SELECT count(*) FROM stats_window) <> 1 OR w.id <> 1 OR w.days <> 14
     OR w.window_start <> '2021-01-01 00:00:00+00' OR w.window_end <> '2021-01-15 00:00:00+00'
     OR w.games <> 4 OR w.aggregated_at <> now()
     OR w.window_end - w.window_start <> 14 * interval '24 hours' THEN
    RAISE EXCEPTION 'stats_window 불일치: %', row_to_json(w);
  END IF;
  RAISE NOTICE '[통과] stats_window: days 14, [2021-01-01 00:00+00, 2021-01-15 00:00+00), games 4, 길이 = 14 × 24시간, aggregated_at = now()';

  -- 어느 게임이 들어갔는지 (s1 챔피언 = 40 + 게임 번호)
  SELECT string_agg(champion_id::text, ',' ORDER BY champion_id) INTO v_got FROM champion WHERE champion_id BETWEEN 41 AND 48;
  IF v_got IS DISTINCT FROM '41,43,46,47' THEN
    RAISE EXCEPTION '포함된 게임 불일치 (기대 A,C,F,G = 41,43,46,47): %', v_got;
  END IF;
  RAISE NOTICE '[통과] 포함: A(정확히 14일 전), C, F, G / 제외: B(14일 + 1µs 전), D(정확히 끝), E(미래), H(9줄)';

  -- 패치 구성
  SELECT string_agg(patch || ':' || games, ',' ORDER BY patch_sort_key(patch) DESC) INTO v_got FROM stats_window_patch;
  IF v_got IS DISTINCT FROM '0.6:3,0.5:1' OR (SELECT sum(games) FROM stats_window_patch) <> w.games THEN
    RAISE EXCEPTION 'stats_window_patch 불일치: %', v_got;
  END IF;
  IF v_res->'patches' <> '[{"patch":"0.6","games":3},{"patch":"0.5","games":1}]'::jsonb
     OR (v_res->>'games')::int <> 4 OR (v_res->>'days')::int <> 14 THEN
    RAISE EXCEPTION '반환 jsonb 불일치: %', v_res;
  END IF;
  RAISE NOTICE '[통과] 패치 구성 0.6 → 3, 0.5 → 1 (합계 4 = games), 반환 patches 최신 패치 먼저';
  RAISE NOTICE '[기준값] 구성 비율 (백엔드 100 × games / stats_window.games): 0.6 = %, 0.5 = %',
    round(100.0 * 3 / 4, 1), round(100.0 * 1 / 4, 1);

  -- 뷰 분모
  IF EXISTS (SELECT 1 FROM champion_tier_view WHERE games <> 4)
     OR (SELECT pick_rate FROM champion_tier_view WHERE champion_id = 41 AND position = 'TOP') <> 25.00 THEN
    RAISE EXCEPTION 'champion_tier_view 분모 불일치';
  END IF;
  RAISE NOTICE '[통과] champion_tier_view.games = 4, 챔피언 41 TOP 픽률 25.00 (1 / 4)';

  -- p_days = 1 → [2021-01-14, 2021-01-15) → C만, 이전 스냅숏의 0.5 줄이 남지 않음
  v_res := refresh_window_stats(1, '2021-01-15 00:00:00+00');
  SELECT string_agg(patch || ':' || games, ',') INTO v_got FROM stats_window_patch;
  IF (SELECT games FROM stats_window) <> 1 OR (SELECT days FROM stats_window) <> 1
     OR (SELECT window_start FROM stats_window) <> '2021-01-14 00:00:00+00'
     OR v_got IS DISTINCT FROM '0.6:1'
     OR (SELECT string_agg(champion_id::text, ',') FROM champion WHERE champion_id BETWEEN 41 AND 48) IS DISTINCT FROM '43' THEN
    RAISE EXCEPTION 'p_days = 1 결과 불일치: %, 구성 %', v_res, v_got;
  END IF;
  RAISE NOTICE '[통과] p_days = 1 → [2021-01-14, 2021-01-15) games 1 (C), 구성 0.6:1 (이전 0.5 줄 없음)';
END $$;
