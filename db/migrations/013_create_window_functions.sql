-- 013: refresh_window_stats, purge_old_games (db_spec 변경 03, 03-4 "013 함수", 계약 v7 9-1·9-2)
-- - refresh_window_stats: [p_until - p_days일, p_until)에 시작한 완료 게임(10줄)으로 집계 7개를 지우고 다시 센다.
--   집계 본문(champion, item, rune, spell, skill)은 009의 refresh_patch_stats와 같고 patch만 뺐다.
-- - purge_old_games: 시작 시각이 p_keep_days일보다 오래된 원본을 지운다. 집계는 남긴다.
-- 함수 본문 안의 DELETE / DROP TABLE pg_temp.* 는 호출될 때만 실행된다 (이 마이그레이션 적용 때 실행되지 않음).
-- 주의: public. 접두사를 쓰지 않는다 (fresh-check가 임시 스키마에 적용하므로)

CREATE OR REPLACE FUNCTION refresh_window_stats(p_days int DEFAULT 14, p_until timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path FROM CURRENT
AS $$
DECLARE
  v_start    timestamptz;
  v_games    int;
  v_patches  jsonb;
  v_champion int;
  v_item     int;
  v_rune     int;
  v_spell    int;
  v_skill    int;
BEGIN
  -- 1. 인자 검사 (잠금보다 먼저)
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'refresh_window_stats: p_days는 1~60이어야 합니다: %', coalesce(p_days::text, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF p_until IS NULL OR p_until > now() THEN
    RAISE EXCEPTION 'refresh_window_stats: p_until은 지금 이전이어야 합니다: %', coalesce(p_until::text, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  v_start := p_until - p_days * interval '24 hours';

  -- 2. 스냅숏이 1개뿐이므로 잠금도 1개 (예약 작업과 백엔드 aggregate가 겹치면 차례로 실행)
  PERFORM pg_advisory_xact_lock(hashtext('refresh_window_stats'));

  -- 같은 트랜잭션 안에서 두 번 부를 때를 위해 이전 임시 테이블을 지운다 (임시 테이블만, 실제 데이터 아님)
  IF to_regclass('pg_temp.tmp_games') IS NOT NULL THEN DROP TABLE pg_temp.tmp_games; END IF;
  IF to_regclass('pg_temp.tmp_base') IS NOT NULL THEN DROP TABLE pg_temp.tmp_base; END IF;

  -- 3. 대상 게임: 창 안에서 시작했고(시작 포함, 끝 제외) match_players가 정확히 10줄인 게임
  CREATE TEMP TABLE tmp_games ON COMMIT DROP AS
  SELECT m.match_id, m.patch
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.match_id
  WHERE m.game_start_at >= v_start
    AND m.game_start_at < p_until
  GROUP BY m.match_id, m.patch
  HAVING count(*) = 10;

  SELECT count(*) INTO v_games FROM tmp_games;
  IF v_games = 0 THEN
    RAISE EXCEPTION 'refresh_window_stats: % ~ % 에 완료된 게임(10줄)이 없습니다. 기존 집계를 그대로 둡니다.', v_start, p_until
      USING ERRCODE = 'P0002';
  END IF;

  -- 4. 대상 게임의 참가자 줄 전체 (포지션 NULL 포함)
  CREATE TEMP TABLE tmp_base ON COMMIT DROP AS
  SELECT mp.*
  FROM match_players mp
  JOIN tmp_games g ON g.match_id = mp.match_id;

  -- 5. 기존 스냅숏 삭제 (DELETE라서 커밋 전까지 읽는 쪽은 이전 스냅숏을 본다. 상세 4개는 CASCADE)
  DELETE FROM champion WHERE true;
  DELETE FROM stats_window_patch WHERE true;
  DELETE FROM stats_window WHERE true;

  -- 6. 창 정보와 패치 구성
  INSERT INTO stats_window (id, days, window_start, window_end, games)
  VALUES (1, p_days, v_start, p_until, v_games);

  INSERT INTO stats_window_patch (patch, games)
  SELECT patch, count(*) FROM tmp_games GROUP BY patch;

  -- 7. champion: 포지션 있는 줄의 pick/win + 포지션 무관 ban(게임 수)
  INSERT INTO champion (champion_id, position, pick, win, ban)
  SELECT c.champion_id, c.team_position, c.pick, c.win, coalesce(b.ban, 0)
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
  INSERT INTO champion_item (champion_id, position, item_id, pick, win)
  SELECT b.champion_id, b.team_position, i.item_id,
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
    champion_id, position,
    primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
    sub_style, sub_perk1, sub_perk2, stat_offense, stat_flex, stat_defense,
    pick, win)
  SELECT r.champion_id, r.team_position,
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
  INSERT INTO champion_spell (champion_id, position, spell1_id, spell2_id, pick, win)
  SELECT s.champion_id, s.team_position, s.spell1_id, s.spell2_id, s.pick, s.win
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
  INSERT INTO champion_skill (champion_id, position, skill_order, pick, win)
  SELECT k.champion_id, k.team_position, k.skill_order, k.pick, k.win
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

  -- 8. 결과 (패치 구성은 최신 패치 먼저)
  SELECT jsonb_agg(jsonb_build_object('patch', patch, 'games', games) ORDER BY patch_sort_key(patch) DESC)
    INTO v_patches
  FROM stats_window_patch;

  RETURN jsonb_build_object(
    'window_start',  v_start,
    'window_end',    p_until,
    'days',          p_days,
    'games',         v_games,
    'patches',       v_patches,
    'champion_rows', v_champion,
    'item_rows',     v_item,
    'rune_rows',     v_rune,
    'spell_rows',    v_spell,
    'skill_rows',    v_skill
  );
END;
$$;

COMMENT ON FUNCTION refresh_window_stats(int, timestamptz) IS '[p_until - p_days일, p_until)에 시작한 완료 게임(10줄)으로 집계 7개(stats_window, stats_window_patch, champion, champion_item/rune/spell/skill)를 지우고 다시 센다. 완료 게임 0개면 오류(P0002, 기존 집계 보존). p_days 1~60, p_until은 지금 이전. 반환 {window_start, window_end, days, games, patches, champion_rows, item_rows, rune_rows, spell_rows, skill_rows}';

CREATE OR REPLACE FUNCTION purge_old_games(p_keep_days int DEFAULT 21)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path FROM CURRENT
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF p_keep_days IS NULL OR p_keep_days < 14 THEN
    RAISE EXCEPTION 'purge_old_games: p_keep_days는 14 이상이어야 합니다: %', coalesce(p_keep_days::text, 'NULL')
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM stats_window WHERE days > p_keep_days) THEN
    RAISE EXCEPTION 'purge_old_games: 현재 창(%일)보다 짧게 보관할 수 없습니다', (SELECT days FROM stats_window)
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM matches WHERE game_start_at < now() - p_keep_days * interval '24 hours';   -- match_players는 CASCADE
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION purge_old_games(int) IS 'game_start_at < now() - p_keep_days일(기본 21)인 matches 삭제(match_players CASCADE). 집계는 남김. p_keep_days가 14 미만이거나 현재 창 days보다 작으면 오류. 삭제한 게임 수 반환';

-- Supabase는 public 함수를 /rest/v1/rpc 로 노출하므로 실행 권한을 회수한다
REVOKE EXECUTE ON FUNCTION refresh_window_stats(int, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION purge_old_games(int)                   FROM PUBLIC, anon, authenticated;
