-- 007: purge_old_patches(p_keep) — 최신 p_keep개 패치보다 오래된 원본 게임 삭제 (db_spec 7-5)
-- 사용: SELECT purge_old_patches(2);  반드시 refresh_patch_stats 뒤에 부른다.
-- 실제 데이터에 실행하면 되돌릴 수 없는 삭제다. 집계 테이블, ranked_players, collection_logs는 지우지 않는다.

CREATE OR REPLACE FUNCTION purge_old_patches(p_keep int DEFAULT 2)
RETURNS int
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path FROM CURRENT
AS $$
DECLARE
  v_deleted int;
BEGIN
  IF p_keep IS NULL OR p_keep < 1 THEN
    RAISE EXCEPTION 'purge_old_patches: p_keep은 1 이상이어야 합니다: %', coalesce(p_keep::text, 'NULL')
      USING ERRCODE = '22023';
  END IF;

  -- 보관 패치: 서로 다른 patch를 patch_sort_key 내림차순으로 앞 p_keep개
  WITH keep AS (
    SELECT d.patch
    FROM (SELECT DISTINCT patch FROM matches) d
    ORDER BY patch_sort_key(d.patch) DESC
    LIMIT p_keep
  )
  DELETE FROM matches m
  WHERE m.patch NOT IN (SELECT k.patch FROM keep k);   -- match_players는 CASCADE

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION purge_old_patches(int) IS '최신 p_keep개(기본 2) 패치보다 오래된 matches 삭제(match_players CASCADE). 집계는 남김. 삭제한 게임 수 반환';

REVOKE EXECUTE ON FUNCTION purge_old_patches(int) FROM PUBLIC, anon, authenticated;
