-- 011: matches.game_start_at 추가 (db_spec 변경 03, 03-4, D14 = (a), 계약 v7)
-- - 흐름 시험용 테스트 26게임(패치 16.19·16.20)을 지우고 game_start_at을 NOT NULL로 추가한다.
-- - 되돌릴 수 없는 삭제 (사용자 승인 2026-10-14, 03-10 1번). ranked_players·collection_logs는 지우지 않는다.
-- - 안전장치가 걸리면 이 파일 전체가 ROLLBACK되고 실행기가 멈춘다 (데이터 변화 없음).
-- 주의: public. 접두사를 쓰지 않는다 (fresh-check가 임시 스키마에 적용하므로)

-- 1. 안전장치: 예상한 테스트 게임만 있을 때만 진행
DO $$
DECLARE
  v_matches int;
  v_players int;
  v_other   text;
BEGIN
  SELECT count(*) INTO v_matches FROM matches;
  SELECT count(*) INTO v_players FROM match_players;
  SELECT string_agg(DISTINCT patch, ',') INTO v_other FROM matches WHERE patch NOT IN ('16.19', '16.20');
  IF v_matches > 26 THEN
    RAISE EXCEPTION '011: matches가 %줄로 예상(26줄 이하)보다 많아 중단합니다. 데이터는 지우지 않았습니다.', v_matches;
  END IF;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION '011: 16.19·16.20 밖 패치(%)가 있어 중단합니다. 데이터는 지우지 않았습니다.', v_other;
  END IF;
  IF v_players > 260 THEN
    RAISE EXCEPTION '011: match_players가 %줄로 예상(260줄 이하)보다 많아 중단합니다. 데이터는 지우지 않았습니다.', v_players;
  END IF;
END $$;

-- 2. 테스트 게임 삭제 (match_players는 CASCADE)
DELETE FROM matches WHERE true;

-- 3. 시작 시각 컬럼 (0줄이므로 NOT NULL로 바로 추가된다)
ALTER TABLE matches ADD COLUMN game_start_at timestamptz NOT NULL;
ALTER TABLE matches ADD CONSTRAINT matches_game_start_at_check
  CHECK (game_start_at >= timestamptz '2020-01-01 00:00:00+00');

-- 4. 주석
COMMENT ON TABLE matches IS '② 게임 1개 = 1줄. 출처: match-v5 /lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420&startTime={지금-14일} + /lol/match/v5/matches/{matchId}';
COMMENT ON COLUMN matches.game_start_at IS '게임 시작 시각. info.gameStartTimestamp (ms → timestamptz). CHECK >= 2020-01-01 (초를 ms로 착각한 1970년 값 거부)';
