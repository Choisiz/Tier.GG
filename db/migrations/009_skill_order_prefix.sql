-- 009: champion_skill을 앞 11레벨 순서로 (db_spec 변경 01, 계약 v5)
-- - champion_skill.skill_priority → skill_order (RENAME), CHECK를 ^[QWER]{11}$ 로 교체
-- - refresh_patch_stats: 006 본문 그대로, 7-4(스킬)만 "앞 11글자, 11자 미만 제외, 상위 10개"로 교체
-- - 집계에서 쓰지 않게 된 skill_priority(text) 함수 삭제 (D6, 사용자 승인)
-- 테이블을 지우거나 다시 만들지 않는다. 집계 줄이 있으면 멈춘다 (예전 형식 값은 새 CHECK를 통과하지 못하므로).
-- 함수 본문 안의 DELETE / DROP TABLE pg_temp.* 는 006과 같은 집계 동작이며, 이 마이그레이션 적용 때 실행되지 않는다.

-- 1. 안전장치: 집계 줄이 있으면 중단 (데이터는 지우지 않음)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM champion_skill) THEN
    RAISE EXCEPTION '009: champion_skill에 기존 형식 줄이 있어 중단합니다. 데이터는 지우지 않았습니다.';
  END IF;
END $$;

-- 2. 컬럼·CHECK 변경. PK(champion_skill_pkey)는 컬럼 이름을 따라가므로 그대로 둔다
--    → (patch, champion_id, position, skill_order)
ALTER TABLE champion_skill DROP CONSTRAINT champion_skill_skill_priority_check;
ALTER TABLE champion_skill RENAME COLUMN skill_priority TO skill_order;
ALTER TABLE champion_skill ADD CONSTRAINT champion_skill_skill_order_check
  CHECK (skill_order ~ '^[QWER]{11}$');

COMMENT ON TABLE champion_skill IS '챔피언 x 포지션별 스킬 찍은 순서 앞 11레벨. skill_order가 11자 이상인 줄만 앞 11글자로 센다. 상위 10개만 저장';
COMMENT ON COLUMN champion_skill.skill_order IS '스킬 찍은 순서 앞 11레벨 (예: EQQWQRQEQEREEW → EQQWQRQEQER)';
COMMENT ON COLUMN champion_skill.pick IS '이 순서로 찍은 게임 수';
COMMENT ON COLUMN champion_skill.win IS '그중 이긴 게임 수';

-- 3. refresh_patch_stats 다시 만들기 (인자·반환 jsonb 키·잠금·오류 코드는 006과 같음)
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

  -- 7-4. champion_skill: skill_order가 11자 이상인 줄만 앞 11글자로 묶는다, 상위 10개 (변경 01)
  --      NULL·빈 문자열·10자 이하는 length() 조건에서 빠진다
  INSERT INTO champion_skill (patch, champion_id, position, skill_order, pick, win)
  SELECT p_patch, k.champion_id, k.team_position, k.skill_order, k.pick, k.win
  FROM (
    SELECT g.*,
           row_number() OVER (
             PARTITION BY g.champion_id, g.team_position
             ORDER BY g.pick DESC, g.win DESC, g.skill_order
           ) AS rn
    FROM (
      SELECT champion_id, team_position,
             left(skill_order, 11) AS skill_order,
             count(*) AS pick,
             count(*) FILTER (WHERE win) AS win
      FROM tmp_base
      WHERE team_position IS NOT NULL
        AND length(skill_order) >= 11
      GROUP BY champion_id, team_position, left(skill_order, 11)
    ) g
  ) k
  WHERE k.rn <= 10;
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

-- 4. 쓰지 않게 된 함수 삭제 (D6 (a), 사용자 승인. 구조만 지우며 데이터 삭제 아님)
DROP FUNCTION skill_priority(text);
