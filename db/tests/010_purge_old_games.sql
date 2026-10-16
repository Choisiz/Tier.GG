-- 010: purge_old_games (db_spec 변경 03, 03-6). 시각은 now() 기준. 항상 ROLLBACK.
--
--   P1 now() - 30일          → 삭제
--   P2 now() - 21일 - 1초    → 삭제
--   P3 now() - 21일 (정확히) → 남음 (< 비교)
--   P4 now() - 15일          → 남음
--   P5 now() - 1일           → 남음
-- 반환값 = 호출 전에 같은 트랜잭션에서 센 game_start_at < now() - 21 × 24시간 게임 수
--   (실제 데이터 중 21일보다 오래된 게임도 함께 세므로 고정값으로 비교하지 않는다. 삭제는 ROLLBACK된다)
-- 집계는 남는다: 먼저 2021년 샘플 2게임으로 refresh_window_stats(14, '2021-01-15+00')를 만든 뒤 purge
DO $$
DECLARE
  v_expected int;
  v_deleted int;
  v_window text;
  v_champion int;
  v_n int;
BEGIN
  -- 2021년 샘플 2게임 → 스냅숏
  INSERT INTO matches (match_id, puuid, patch, game_start_at)
  SELECT 'KR_950000000' || g, NULL, '0.7', timestamptz '2021-01-10 00:00:00+00' FROM generate_series(1, 2) AS g;
  -- 나이 시험 5게임
  INSERT INTO matches (match_id, puuid, patch, game_start_at) VALUES
    ('KR_9600000001', NULL, '0.8', now() - 30 * interval '24 hours'),
    ('KR_9600000002', NULL, '0.8', now() - 21 * interval '24 hours' - interval '1 second'),
    ('KR_9600000003', NULL, '0.8', now() - 21 * interval '24 hours'),
    ('KR_9600000004', NULL, '0.8', now() - 15 * interval '24 hours'),
    ('KR_9600000005', NULL, '0.8', now() - 1 * interval '24 hours');
  INSERT INTO match_players
  SELECT m.match_id, m.match_id || '-p' || s, 100 + s,
         (ARRAY['TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY','TOP','JUNGLE','MIDDLE','BOTTOM','UTILITY'])[s],
         s <= 5, NULL, 14, 4,
         8100, 9923, 8143, 8140, 8135, 8000, 8299, 9104, 5008, 5008, 5011, 1018, 0, 0, 0, 0, 0, NULL
  FROM matches m, generate_series(1, 10) AS s
  WHERE m.match_id LIKE 'KR_950000000_' OR m.match_id LIKE 'KR_960000000_';

  PERFORM refresh_window_stats(14, '2021-01-15 00:00:00+00');
  SELECT row(w.days, w.window_start, w.window_end, w.games)::text INTO v_window FROM stats_window w;
  SELECT count(*) INTO v_champion FROM champion;

  -- 인자 오류 → 22023
  BEGIN
    PERFORM purge_old_games(13);
    RAISE EXCEPTION 'p_keep_days = 13 이 허용됨';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM purge_old_games(NULL);
    RAISE EXCEPTION 'p_keep_days = NULL 이 허용됨';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  -- 현재 창(30일)보다 짧게 보관 → 22023 (하위 트랜잭션 안에서 days를 바꿨다가 되돌림)
  BEGIN
    UPDATE stats_window SET days = 30 WHERE true;
    PERFORM purge_old_games(21);
    RAISE EXCEPTION 'stats_window.days = 30 인데 purge_old_games(21) 이 허용됨';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT days FROM stats_window) <> 14 THEN RAISE EXCEPTION '하위 트랜잭션 되돌림 실패'; END IF;
  RAISE NOTICE '[통과] 인자 오류 3건 → 22023 (13, NULL, 현재 창 30일 > 21)';

  -- 삭제
  SELECT count(*) INTO v_expected FROM matches WHERE game_start_at < now() - 21 * interval '24 hours';
  v_deleted := purge_old_games(21);
  IF v_deleted <> v_expected THEN RAISE EXCEPTION '삭제 수 % <> 기대 %', v_deleted, v_expected; END IF;
  IF EXISTS (SELECT 1 FROM matches WHERE match_id IN ('KR_9600000001', 'KR_9600000002', 'KR_9500000001', 'KR_9500000002'))
     OR EXISTS (SELECT 1 FROM match_players WHERE match_id IN ('KR_9600000001', 'KR_9600000002')) THEN
    RAISE EXCEPTION 'P1·P2(또는 2021년 샘플)가 지워지지 않음 (match_players CASCADE 포함)';
  END IF;
  SELECT count(*) INTO v_n FROM match_players WHERE match_id IN ('KR_9600000003', 'KR_9600000004', 'KR_9600000005');
  IF v_n <> 30 OR (SELECT count(*) FROM matches WHERE match_id LIKE 'KR_960000000_') <> 3 THEN
    RAISE EXCEPTION 'P3~P5가 남지 않음 (match_players %줄, 기대 30)', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM matches WHERE game_start_at < now() - 21 * interval '24 hours') THEN
    RAISE EXCEPTION '21일보다 오래된 게임이 남음';
  END IF;
  RAISE NOTICE '[통과] purge_old_games(21) = % (= 호출 전 21일 초과 게임 수, 샘플 4개 포함): P1·P2 삭제(CASCADE), P3(정확히 21일)·P4·P5 남음 (match_players 30줄)', v_deleted;

  -- 집계는 남음
  IF (SELECT row(w.days, w.window_start, w.window_end, w.games)::text FROM stats_window w) IS DISTINCT FROM v_window
     OR (SELECT count(*) FROM champion) <> v_champion THEN
    RAISE EXCEPTION 'purge 뒤 집계가 바뀜';
  END IF;
  RAISE NOTICE '[통과] 집계 유지: stats_window %, champion %줄', v_window, v_champion;

  -- 두 번째는 0
  v_deleted := purge_old_games(21);
  IF v_deleted <> 0 THEN RAISE EXCEPTION '두 번째 purge 삭제 수 = %', v_deleted; END IF;
  RAISE NOTICE '[통과] 두 번째 purge_old_games(21) = 0';
END $$;
