-- 008: champion_tier_view — 비율·보정 승률·티어 점수·티어를 조회할 때 계산 (db_spec 7-6, D1 = (a))
-- 사용: SELECT * FROM champion_tier_view WHERE patch = $1 AND position = $2 ORDER BY tier NULLS LAST, tier_score DESC;
-- 기준값(50판, 100판, 0.10, 0.03, 경계값)을 바꿀 때는 새 마이그레이션에서 CREATE OR REPLACE VIEW / FUNCTION.
-- security_invoker = true: 뷰 주인 권한으로 RLS를 우회하지 않게 한다.

CREATE OR REPLACE VIEW champion_tier_view
WITH (security_invoker = true)
AS
SELECT
  c.patch,
  c.champion_id,
  c.position,
  c.pick,
  c.win,
  c.ban,
  p.games,
  round(100.0 * c.win / c.pick, 2)               AS win_rate,
  round(100.0 * c.pick / p.games, 2)             AS pick_rate,
  round(100.0 * c.ban / p.games, 2)              AS ban_rate,
  round(100.0 * (c.win + 50) / (c.pick + 100), 2) AS adjusted_win_rate,
  round(s.score, 3)                              AS tier_score,
  CASE WHEN c.pick < 50 THEN NULL ELSE tier_from_score(s.score) END AS tier
FROM champion c
JOIN patch p ON p.patch = c.patch
CROSS JOIN LATERAL (
  -- 반올림 전 값으로 점수를 계산한다
  SELECT 100.0 * (c.win + 50) / (c.pick + 100)
         + 0.10 * least(100.0 * c.pick / p.games, 20)
         + 0.03 * least(100.0 * c.ban / p.games, 30) AS score
) s;

COMMENT ON VIEW champion_tier_view IS '챔피언 x 포지션 티어리스트. 승률·픽률·밴률·보정 승률(사전 100판 50%)·티어 점수·티어(pick 50 미만 NULL)';
COMMENT ON COLUMN champion_tier_view.win_rate IS 'round(100 * win / pick, 2)';
COMMENT ON COLUMN champion_tier_view.pick_rate IS 'round(100 * pick / games, 2)';
COMMENT ON COLUMN champion_tier_view.ban_rate IS 'round(100 * ban / games, 2)';
COMMENT ON COLUMN champion_tier_view.adjusted_win_rate IS 'round(100 * (win + 50) / (pick + 100), 2)';
COMMENT ON COLUMN champion_tier_view.tier_score IS 'round(보정 승률 + 0.10 * least(픽률, 20) + 0.03 * least(밴률, 30), 3). 반올림 전 값으로 계산';
COMMENT ON COLUMN champion_tier_view.tier IS 'pick < 50 이면 NULL, 아니면 tier_from_score(반올림 전 점수) 1~5';

REVOKE ALL ON champion_tier_view FROM anon, authenticated;
