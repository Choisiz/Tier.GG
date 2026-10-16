-- 005: 보조 함수 patch_sort_key, skill_priority, tier_from_score (db_spec 7-1, 7-4, 7-6)
-- 모든 함수는 SET search_path FROM CURRENT 로 만든다 (실행기가 search_path를 정한 뒤 적용).

-- 패치 순서 비교용. '16.9' → {16,9}  (문자열 정렬이면 '16.9' > '16.19'가 되므로)
CREATE OR REPLACE FUNCTION patch_sort_key(p_patch text)
RETURNS int[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path FROM CURRENT
AS $$
  SELECT string_to_array(p_patch, '.')::int[];
$$;

COMMENT ON FUNCTION patch_sort_key(text) IS '패치 정렬 키. ''16.9'' → {16,9}. ORDER BY patch_sort_key(patch) DESC 로 최신 패치 순';

-- 스킬 마스터 순서. Q, W, E 각각 5번째로 찍은 위치를 구해 빠른 순으로 잇는다 (R 제외).
-- 5번째에 도달한 스킬이 2개 미만이면 NULL. 도달하지 못한 스킬은 마지막.
-- 예: 'EQQWQRQEQEREEW' → Q 5번째 = 9번째 글자, E 5번째 = 13번째 글자, W 2번 → 'Q>E>W'
CREATE OR REPLACE FUNCTION skill_priority(p_order text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path FROM CURRENT
AS $$
  SELECT CASE WHEN count(fifth) >= 2
              THEN string_agg(skill, '>' ORDER BY fifth NULLS LAST, ord) END
  FROM (
    SELECT v.skill, v.ord,
           (SELECT t.i FROM (
              SELECT g.i, row_number() OVER (ORDER BY g.i) AS c
              FROM generate_series(1, length(p_order)) AS g(i)
              WHERE substr(p_order, g.i, 1) = v.skill) t
            WHERE t.c = 5) AS fifth
    FROM (VALUES ('Q', 1), ('W', 2), ('E', 3)) AS v(skill, ord)
  ) s;
$$;

COMMENT ON FUNCTION skill_priority(text) IS '스킬 순서 문자열 → 마스터 순서 (예: EQQWQRQEQEREEW → Q>E>W). Q/W/E 중 5레벨 도달이 2개 미만이면 NULL';

-- 티어 점수 → 1~5티어. 경계 53.0 / 51.5 / 50.0 / 48.5
CREATE OR REPLACE FUNCTION tier_from_score(p_score numeric)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path FROM CURRENT
AS $$
  SELECT (CASE
            WHEN p_score IS NULL  THEN NULL
            WHEN p_score >= 53.0  THEN 1
            WHEN p_score >= 51.5  THEN 2
            WHEN p_score >= 50.0  THEN 3
            WHEN p_score >= 48.5  THEN 4
            ELSE 5
          END)::smallint;
$$;

COMMENT ON FUNCTION tier_from_score(numeric) IS '티어 점수 → 1~5티어. 1: >= 53.0, 2: >= 51.5, 3: >= 50.0, 4: >= 48.5, 5: 그 미만';

-- Supabase는 public 함수를 /rest/v1/rpc 로 노출하므로 실행 권한을 회수한다
REVOKE EXECUTE ON FUNCTION patch_sort_key(text)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION skill_priority(text)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION tier_from_score(numeric)   FROM PUBLIC, anon, authenticated;
