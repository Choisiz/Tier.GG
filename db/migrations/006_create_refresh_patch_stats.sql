-- 006: refresh_patch_stats(p_patch) — 패치 1개의 집계 6개를 처음부터 다시 센다 (db_spec 7-2, 7-3)
-- 사용: SELECT refresh_patch_stats('16.19');
-- 함수 1번 호출 = 트랜잭션 1개. 중간에 실패하면 이전 집계가 그대로 남는다.
-- 같은 패치를 몇 번 다시 불러도 결과가 같다 (지우고 다시 넣음).

CREATE OR REPLACE FUNCTION refresh_patch_stats(p_patch text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path FROM CURRENT
AS $$
DECLARE
  v_games    int;
  v_champion int;
  v_item     int;
  v_rune     int;
  v_spell    int;
  v_skill    int;
BEGIN
  -- 1. 패치 형식 검사 (NULL이면 잠금 키를 만들 수 없으므로 잠금보다 먼저 검사)
  IF p_patch IS NULL OR p_patch !~ '^[0-9]+\.[0-9]+$' THEN
    RAISE EXCEPTION 'refresh_patch_stats: 패치 형식이 아닙니다: %', coalesce(p_patch, 'NULL')
      USING ERRCODE = '22023';
  END IF;

  -- 0. 같은 패치를 동시에 두 번 집계하지 않게
  PERFORM pg_advisory_xact_lock(hashtext('refresh_patch_stats:' || p_patch));

  -- 같은 트랜잭션 안에서 두 번 부를 때를 위해 이전 임시 테이블을 지운다 (임시 테이블만, 실제 데이터 아님)
  IF to_regclass('pg_temp.tmp_games') IS NOT NULL THEN DROP TABLE pg_temp.tmp_games; END IF;
  IF to_regclass('pg_temp.tmp_base') IS NOT NULL THEN DROP TABLE pg_temp.tmp_base; END IF;

  -- 2. 대상 게임: 이 패치이고 match_players가 정확히 10줄인 게임
  CREATE TEMP TABLE tmp_games ON COMMIT DROP AS
  SELECT m.match_id
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.match_id
  WHERE m.patch = p_patch
  GROUP BY m.match_id
  HAVING count(*) = 10;

  SELECT count(*) INTO v_games FROM tmp_games;
  IF v_games = 0 THEN
    RAISE EXCEPTION 'refresh_patch_stats: 패치 %에 완료된 게임(10줄)이 없습니다. 기존 집계를 그대로 둡니다.', p_patch
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. 대상 게임의 참가자 줄 전체 (포지션 NULL 포함)
  CREATE TEMP TABLE tmp_base ON COMMIT DROP AS
  SELECT mp.*
  FROM match_players mp
  JOIN tmp_games g ON g.match_id = mp.match_id;

  -- 4. 기존 집계 삭제 (champion, 상세 4개는 CASCADE)
  DELETE FROM patch WHERE patch = p_patch;

  -- 5. 패치 게임 수
  INSERT INTO patch (patch, games) VALUES (p_patch, v_games);

  -- 6. champion: 포지션 있는 줄의 pick/win + 포지션 무관 ban(게임 수)
  INSERT INTO champion (patch, champion_id, position, pick, win, ban)
  SELECT p_patch, c.champion_id, c.team_position, c.pick, c.win, coalesce(b.ban, 0)
  FROM (
    SELECT champion_id, team_position,
           count(*) AS pick,
           count(*) FILTER (WHERE win) AS win
    FROM tmp_base
    WHERE team_position IS NOT NULL
    GROUP BY champion_id, team_position
  ) c
  LEFT JOIN (
    SELECT ban_champion_id AS champion_id, count(DISTINCT match_id) AS ban
    FROM tmp_base
    WHERE ban_champion_id IS NOT NULL
    GROUP BY ban_champion_id
  ) b ON b.champion_id = c.champion_id;
  GET DIAGNOSTICS v_champion = ROW_COUNT;

  -- 7-1. champion_item: 한 줄 안 같은 아이템은 1번, 빈 칸 0·NULL 제외, 모두 저장
  INSERT INTO champion_item (patch, champion_id, position, item_id, pick, win)
  SELECT p_patch, b.champion_id, b.team_position, i.item_id,
         count(*), count(*) FILTER (WHERE b.win)
  FROM tmp_base b
  CROSS JOIN LATERAL (
    SELECT DISTINCT x AS item_id
    FROM unnest(ARRAY[b.item0, b.item1, b.item2, b.item3, b.item4, b.item5]) AS x
    WHERE x > 0
  ) i
  WHERE b.team_position IS NOT NULL
  GROUP BY b.champion_id, b.team_position, i.item_id;
  GET DIAGNOSTICS v_item = ROW_COUNT;

  -- 7-2. champion_rune: 룬 페이지 11개 컬럼 조합, 상위 10개
  INSERT INTO champion_rune (
    patch, champion_id, position,
    primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
    sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense,
    pick, win)
  SELECT p_patch, r.champion_id, r.team_position,
         r.primary_style, r.primary_perk1, r.primary_perk2, r.primary_perk3, r.primary_perk4,
         r.sub_style, r.sub_perk1, r.sub_perk2, r.stat_offense, r.stat_flex, r.stat_defense,
         r.pick, r.win
  FROM (
    SELECT g.*,
           row_number() OVER (
             PARTITION BY g.champion_id, g.team_position
             ORDER BY g.pick DESC, g.win DESC,
                      g.primary_style, g.primary_perk1, g.primary_perk2, g.primary_perk3, g.primary_perk4,
                      g.sub_style, g.sub_perk1, g.sub_perk2, g.stat_offense, g.stat_flex, g.stat_defense
           ) AS rn
    FROM (
      SELECT champion_id, team_position,
             primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
             sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense,
             count(*) AS pick,
             count(*) FILTER (WHERE win) AS win
      FROM tmp_base
      WHERE team_position IS NOT NULL
      GROUP BY champion_id, team_position,
               primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
               sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense
    ) g
  ) r
  WHERE r.rn <= 10;
  GET DIAGNOSTICS v_rune = ROW_COUNT;

  -- 7-3. champion_spell: (작은 번호, 큰 번호) 조합, 상위 10개
  --      두 주문이 같은 줄은 실제로 나올 수 없고 spell1_id < spell2_id CHECK를 어기므로 뺀다
  INSERT INTO champion_spell (patch, champion_id, position, spell1_id, spell2_id, pick, win)
  SELECT p_patch, s.champion_id, s.team_position, s.spell1_id, s.spell2_id, s.pick, s.win
  FROM (
    SELECT g.*,
           row_number() OVER (
             PARTITION BY g.champion_id, g.team_position
             ORDER BY g.pick DESC, g.win DESC, g.spell1_id, g.spell2_id
           ) AS rn
    FROM (
      SELECT champion_id, team_position,
             least(summoner1_id, summoner2_id)    AS spell1_id,
             greatest(summoner1_id, summoner2_id) AS spell2_id,
             count(*) AS pick,
             count(*) FILTER (WHERE win) AS win
      FROM tmp_base
      WHERE team_position IS NOT NULL
        AND summoner1_id <> summoner2_id
      GROUP BY champion_id, team_position,
               least(summoner1_id, summoner2_id), greatest(summoner1_id, summoner2_id)
    ) g
  ) s
  WHERE s.rn <= 10;
  GET DIAGNOSTICS v_spell = ROW_COUNT;

  -- 7-4. champion_skill: skill_priority가 NULL이 아닌 줄만, 모두 저장 (최대 6개)
  INSERT INTO champion_skill (patch, champion_id, position, skill_priority, pick, win)
  SELECT p_patch, k.champion_id, k.team_position, k.skill_priority,
         count(*), count(*) FILTER (WHERE k.win)
  FROM (
    SELECT champion_id, team_position, win, skill_priority(skill_order) AS skill_priority
    FROM tmp_base
    WHERE team_position IS NOT NULL
  ) k
  WHERE k.skill_priority IS NOT NULL
  GROUP BY k.champion_id, k.team_position, k.skill_priority;
  GET DIAGNOSTICS v_skill = ROW_COUNT;

  -- 8. 결과
  RETURN jsonb_build_object(
    'patch',         p_patch,
    'games',         v_games,
    'champion_rows', v_champion,
    'item_rows',     v_item,
    'rune_rows',     v_rune,
    'spell_rows',    v_spell,
    'skill_rows',    v_skill
  );
END;
$$;

COMMENT ON FUNCTION refresh_patch_stats(text) IS '패치 1개의 집계 6개(patch, champion, champion_item/rune/spell/skill)를 지우고 다시 센다. 완료된 게임(10줄)이 0개면 오류. 반환 {patch, games, champion_rows, item_rows, rune_rows, spell_rows, skill_rows}';

REVOKE EXECUTE ON FUNCTION refresh_patch_stats(text) FROM PUBLIC, anon, authenticated;
