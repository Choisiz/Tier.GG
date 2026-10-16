-- 014: champion_tier_view 다시 만들기 (db_spec 변경 03, 03-4 "014 뷰", 계약 v7 9-3)
-- - champion CROSS JOIN stats_window. patch 컬럼 없음, 분모는 stats_window.games
-- - 공식·경계값(50판, 100판 50%, 0.10, 0.03, tier_from_score)은 008과 같다
-- - stats_window가 0줄이면 뷰도 0줄
-- 사용: SELECT * FROM champion_tier_view WHERE position = $1 ORDER BY tier NULLS LAST, tier_score DESC;
-- security_invoker = true: 뷰 주인 권한으로 RLS를 우회하지 않게 한다.
-- 주의: public. 접두사를 쓰지 않는다 (fresh-check가 임시 스키마에 적용하므로)

CREATE VIEW champion_tier_view
WITH (security_invoker = true)
AS
SELECT
  c.champion_id,
  c.position,
  c.pick,
  c.win,
  c.ban,
  w.games,
  round(100.0 * c.win / c.pick, 2)                AS win_rate,
  round(100.0 * c.pick / w.games, 2)              AS pick_rate,
  round(100.0 * c.ban / w.games, 2)               AS ban_rate,
  round(100.0 * (c.win + 50) / (c.pick + 100), 2) AS adjusted_win_rate,
  round(s.score, 3)                               AS tier_score,
  CASE WHEN c.pick < 50 THEN NULL ELSE tier_from_score(s.score) END AS tier
FROM champion c
CROSS JOIN stats_window w
CROSS JOIN LATERAL (
  -- 반올림 전 값으로 점수를 계산한다
  SELECT 100.0 * (c.win + 50) / (c.pick + 100)
         + 0.10 * least(100.0 * c.pick / w.games, 20)
         + 0.03 * least(100.0 * c.ban / w.games, 30) AS score
) s;

COMMENT ON VIEW champion_tier_view IS '챔피언 x 포지션 티어리스트 (현재 14일 창). 승률·픽률·밴률·보정 승률(사전 100판 50%)·티어 점수·티어(pick 50 미만 NULL)';
COMMENT ON COLUMN champion_tier_view.games IS 'stats_window.games (창 안의 완료 게임 수)';
COMMENT ON COLUMN champion_tier_view.win_rate IS 'round(100 * win / pick, 2)';
COMMENT ON COLUMN champion_tier_view.pick_rate IS 'round(100 * pick / games, 2)';
COMMENT ON COLUMN champion_tier_view.ban_rate IS 'round(100 * ban / games, 2)';
COMMENT ON COLUMN champion_tier_view.adjusted_win_rate IS 'round(100 * (win + 50) / (pick + 100), 2)';
COMMENT ON COLUMN champion_tier_view.tier_score IS 'round(보정 승률 + 0.10 * least(픽률, 20) + 0.03 * least(밴률, 30), 3). 반올림 전 값으로 계산';
COMMENT ON COLUMN champion_tier_view.tier IS 'pick < 50 이면 NULL, 아니면 tier_from_score(반올림 전 점수) 1~5';

REVOKE ALL ON champion_tier_view FROM anon, authenticated;
