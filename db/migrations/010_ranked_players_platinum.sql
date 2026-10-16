-- 010: ranked_players.tier에 PLATINUM 허용 (db_spec 변경 02, 계약 v6)
-- 데이터를 지우지 않는다. 지금 0줄이지만 ADD CONSTRAINT는 NOT VALID 없이 기존 줄을 검사한다.
-- DROP CONSTRAINT는 같은 트랜잭션에서 같은 이름으로 바로 다시 만드는 구조 변경이다 (009와 같은 판단).
-- D10 = (a): 집계 전 ANALYZE는 백엔드 규칙(계약 9-4)이므로 refresh_patch_stats는 바꾸지 않는다.
-- 주의: public. 접두사를 쓰지 않는다 (fresh-check가 임시 스키마에 적용하므로)

ALTER TABLE ranked_players DROP CONSTRAINT ranked_players_tier_check;
ALTER TABLE ranked_players ADD CONSTRAINT ranked_players_tier_check
  CHECK (tier IN ('PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'));

COMMENT ON TABLE ranked_players IS '① 수집 대상 플레이어 (표본). 출처: league-v4 /lol/league/v4/entries/{queue}/{tier}/{division}, 마스터 이상은 masterleagues 등. 테스트 수집: 플래티넘~다이아 각 50명, 본 수집: 에메랄드 이상';
COMMENT ON COLUMN ranked_players.tier IS 'tier (마스터 이상은 리스트 최상위 tier). PLATINUM | EMERALD | DIAMOND | MASTER | GRANDMASTER | CHALLENGER';
