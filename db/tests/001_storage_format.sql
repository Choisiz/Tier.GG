-- 001: 저장 형식 (db_spec 8-4). 항상 ROLLBACK 되는 트랜잭션 안에서 실행된다.
-- 실제 예시 1행(KR_8408851980 참가자 1)이 모든 CHECK를 통과하고, 잘못된 값은 거부되는지 확인한다.
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
  INSERT INTO matches (match_id, puuid, patch) VALUES ('KR_8408851980', 'sample-puuid-1', '16.19');
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
    INSERT INTO matches (match_id, puuid, patch) VALUES ('KR_1', NULL, '16.19.823');
    RAISE EXCEPTION 'patch = ''16.19.823'' 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO matches (match_id, puuid, patch) VALUES ('NA1_1', NULL, '16.19');
    RAISE EXCEPTION 'match_id = ''NA1_1'' 이 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  BEGIN
    INSERT INTO patch (patch, games) VALUES ('0.99', 1);
    INSERT INTO champion (patch, champion_id, position, pick, win, ban) VALUES ('0.99', 23, 'TOP', 1, 1, 0);
    INSERT INTO champion_spell (patch, champion_id, position, spell1_id, spell2_id, pick, win)
      VALUES ('0.99', 23, 'TOP', 14, 4, 1, 1);
    RAISE EXCEPTION 'champion_spell spell1_id = 14, spell2_id = 4 가 허용됨';
  EXCEPTION WHEN check_violation THEN v_rejected := v_rejected + 1; END;
  RAISE NOTICE '[통과] 거부 7건 중 %건 거부됨', v_rejected;
  IF v_rejected <> 7 THEN RAISE EXCEPTION '거부 건수 % <> 7', v_rejected; END IF;

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
