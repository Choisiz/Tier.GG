-- 001: 저장 형식 (db_spec 8-4, 변경 03 03-6). 항상 ROLLBACK 되는 트랜잭션 안에서 실행된다.
-- 실제 예시 1행(KR_8408851980 참가자 1)이 모든 CHECK를 통과하고, 잘못된 값은 거부되는지 확인한다.
-- 변경 03: matches.game_start_at (fixture info.gameStartTimestamp 1791263990514 = 2026-10-06 05:19:50.514+00),
--          집계 형식 검사를 patch → stats_window, stats_window_patch 로
DO $$
DECLARE
  v_rejected int := 0;
  v_allowed  int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM matches WHERE match_id = 'KR_8408851980') THEN
    RAISE NOTICE '[건너뜀] KR_8408851980이 이미 있어 저장 형식 검사를 건너뜁니다';
    RETURN;
  END IF;

  INSERT INTO ranked_players (puuid, tier, rank) VALUES ('sample-puuid-1', 'EMERALD', 'II');
  INSERT INTO matches (match_id, puuid, patch, game_start_at)
    VALUES ('KR_8408851980', 'sample-puuid-1', '16.19', to_timestamp(1791263990514 / 1000.0));
  INSERT INTO match_players VALUES (
    'KR_8408851980', 'sample-puuid-1', 23, 'TOP', true, 64,
    14, 4,
    8100, 9923, 8143, 8140, 8135, 8000, 8299, 9104, 5008, 5008, 5011,
    1018, 3074, 3006, 3046, 1036, 1036,
    'EQQWQRQEQEREEW');
  RAISE NOTICE '[통과] 실제 예시 1행 저장';

  -- 거부되어야 하는 값 (각각 하위 트랜잭션에서 시도)
  BEGIN
    INSERT INTO match_players VALUES ('KR_8408851980','r1',23,'',true,NULL,14,4,8100,9923,8143,8140,8135,8000,8299,9104,5008,5008,5011,0,0,0,0,0,0,NULL);
    RAISE EXCEPTION 'team_position = '''' 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO match_players VALUES ('KR_8408851980','r2',23,'TOP',true,-1,14,4,8100,9923,8143,8140,8135,8000,8299,9104,5008,5008,5011,0,0,0,0,0,0,NULL);
    RAISE EXCEPTION 'ban_champion_id = -1 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO match_players VALUES ('KR_8408851980','r3',23,'TOP',true,NULL,14,4,8100,9923,8143,8140,8135,8000,8299,9104,5008,5008,5011,-1,0,0,0,0,0,NULL);
    RAISE EXCEPTION 'item0 = -1 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO match_players VALUES ('KR_8408851980','r4',23,'TOP',true,NULL,14,4,8100,9923,8143,8140,8135,8000,8299,9104,5008,5008,5011,0,0,0,0,0,0,'QX');
    RAISE EXCEPTION 'skill_order = ''QX'' 가 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO matches (match_id, puuid, patch, game_start_at) VALUES ('KR_1', NULL, '16.19.823', '2021-01-10 00:00:00+00');
    RAISE EXCEPTION 'patch = ''16.19.823'' 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO matches (match_id, puuid, patch, game_start_at) VALUES ('NA1_1', NULL, '16.19', '2021-01-10 00:00:00+00');
    RAISE EXCEPTION 'match_id = ''NA1_1'' 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO champion (champion_id, position, pick, win, ban) VALUES (9999, 'TOP', 1, 1, 0);
    INSERT INTO champion_spell (champion_id, position, spell1_id, spell2_id, pick, win)
      VALUES (9999, 'TOP', 14, 4, 1, 1);
    RAISE EXCEPTION 'champion_spell spell1_id = 14, spell2_id = 4 가 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;

  -- 변경 03: 시작 시각
  BEGIN
    INSERT INTO matches (match_id, puuid, patch, game_start_at) VALUES ('KR_2', NULL, '16.19', NULL);
    RAISE EXCEPTION 'game_start_at = NULL 이 허용됨';
  EXCEPTION WHEN not_null_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    -- 초(1791263990)를 ms로 착각해 new Date(1791263990)으로 만든 값 = 1970-01-21
    INSERT INTO matches (match_id, puuid, patch, game_start_at) VALUES ('KR_3', NULL, '16.19', to_timestamp(1791263990 / 1000.0));
    RAISE EXCEPTION 'game_start_at = 1970-01-21 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;

  -- 변경 03: stats_window, stats_window_patch
  BEGIN
    INSERT INTO stats_window (id, days, window_start, window_end, games)
      VALUES (2, 14, '2021-01-01+00', '2021-01-15+00', 1);
    RAISE EXCEPTION 'stats_window.id = 2 가 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO stats_window (id, days, window_start, window_end, games)
      VALUES (1, 0, '2021-01-01+00', '2021-01-15+00', 1);
    RAISE EXCEPTION 'stats_window.days = 0 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO stats_window (id, days, window_start, window_end, games)
      VALUES (1, 14, '2021-01-15+00', '2021-01-15+00', 1);
    RAISE EXCEPTION 'stats_window.window_start = window_end 가 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO stats_window (id, days, window_start, window_end, games)
      VALUES (1, 14, '2021-01-01+00', '2021-01-15+00', 0);
    RAISE EXCEPTION 'stats_window.games = 0 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO stats_window_patch (patch, games) VALUES ('16.19.1', 1);
    RAISE EXCEPTION 'stats_window_patch.patch = ''16.19.1'' 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO stats_window_patch (patch, games) VALUES ('16.19', 0);
    RAISE EXCEPTION 'stats_window_patch.games = 0 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  RAISE NOTICE '[통과] 거부 15건 중 %건 거부됨 (game_start_at NULL 23502, 1970-01-21 23514, stats_window 4건, stats_window_patch 2건 포함)', v_rejected;
  IF v_rejected <> 15 THEN RAISE EXCEPTION '거부 건수 % <> 15', v_rejected; END IF;

  -- 허용: stats_window 1줄 (id 기본값 1, aggregated_at 기본값 now()), stats_window_patch 1줄
  -- 실제 스냅숏이 있으면 PK가 겹치므로 먼저 지운다 (트랜잭션은 항상 ROLLBACK)
  DELETE FROM stats_window WHERE true;
  DELETE FROM stats_window_patch WHERE patch = '0.99';
  INSERT INTO stats_window (days, window_start, window_end, games) VALUES (14, '2021-01-01+00', '2021-01-15+00', 1);
  INSERT INTO stats_window_patch (patch, games) VALUES ('0.99', 1);
  IF (SELECT id FROM stats_window) <> 1 OR (SELECT aggregated_at FROM stats_window) <> now() THEN
    RAISE EXCEPTION 'stats_window 기본값(id 1, aggregated_at now()) 불일치';
  END IF;
  RAISE NOTICE '[통과] stats_window 기본값 id = 1, aggregated_at = now(), stats_window_patch 1줄 저장';
  IF (SELECT game_start_at FROM matches WHERE match_id = 'KR_8408851980') <> '2026-10-06 05:19:50.514+00'::timestamptz THEN
    RAISE EXCEPTION 'game_start_at 변환 불일치: %', (SELECT game_start_at FROM matches WHERE match_id = 'KR_8408851980');
  END IF;
  RAISE NOTICE '[통과] game_start_at: 1791263990514 ms → 2026-10-06 05:19:50.514+00';

  -- 허용되어야 하는 값
  INSERT INTO match_players VALUES ('KR_8408851980','a1',23,NULL,true,NULL,14,4,8100,9923,8143,8140,8135,8000,8299,9104,5008,5008,5011,0,0,0,0,0,0,NULL);
  v_allowed := v_allowed + 1;  -- team_position NULL, ban NULL, item0 = 0 (한 줄로 함께 확인)
  INSERT INTO match_players VALUES ('KR_8408851980','a2',23,'JUNGLE',false,NULL,14,4,8100,9923,8143,8140,8135,8000,8299,9104,5008,5008,5011,0,1036,1036,0,0,0,'');
  v_allowed := v_allowed + 1;  -- skill_order 빈 문자열
  RAISE NOTICE '[통과] 허용 %건 (team_position NULL, ban_champion_id NULL, item0 = 0, skill_order 빈 문자열)', v_allowed;

  -- FK 삭제 동작: matches 삭제 → match_players CASCADE, ranked_players 삭제 → matches.puuid SET NULL
  DELETE FROM ranked_players WHERE puuid = 'sample-puuid-1';
  IF (SELECT puuid FROM matches WHERE match_id = 'KR_8408851980') IS NOT NULL THEN
    RAISE EXCEPTION 'matches.puuid ON DELETE SET NULL 이 동작하지 않음';
  END IF;
  DELETE FROM matches WHERE match_id = 'KR_8408851980';
  IF EXISTS (SELECT 1 FROM match_players WHERE match_id = 'KR_8408851980') THEN
    RAISE EXCEPTION 'match_players ON DELETE CASCADE 가 동작하지 않음';
  END IF;
  RAISE NOTICE '[통과] FK 삭제 동작 (SET NULL, CASCADE)';
END $$;
