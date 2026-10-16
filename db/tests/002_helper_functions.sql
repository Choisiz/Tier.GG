-- 002: 보조 함수 (db_spec 8-5 첫 항목). skill_priority는 009에서 삭제되어 검사하지 않음 (변경 01, 007에서 삭제 확인)
DO $$
DECLARE
  r record;
BEGIN
  IF NOT (patch_sort_key('16.9') < patch_sort_key('16.19')) THEN
    RAISE EXCEPTION 'patch_sort_key: 16.9 < 16.19 가 아님';
  END IF;
  IF patch_sort_key('16.19') <> ARRAY[16, 19] THEN RAISE EXCEPTION 'patch_sort_key(16.19) <> {16,19}'; END IF;
  RAISE NOTICE '[통과] patch_sort_key(''16.9'') = % < patch_sort_key(''16.19'') = %',
    patch_sort_key('16.9'), patch_sort_key('16.19');

  FOR r IN
    SELECT * FROM (VALUES
      (60.0::numeric, 1::smallint), (53.0, 1), (52.999, 2), (51.5, 2), (51.499, 3),
      (50.0, 3), (49.999, 4), (48.5, 4), (48.499, 5), (10.0, 5)
    ) AS t(score, expected)
  LOOP
    IF tier_from_score(r.score) IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'tier_from_score(%) = %, 기대 %', r.score, tier_from_score(r.score), r.expected;
    END IF;
  END LOOP;
  IF tier_from_score(NULL) IS NOT NULL THEN RAISE EXCEPTION 'tier_from_score(NULL) IS NOT NULL'; END IF;
  RAISE NOTICE '[통과] tier_from_score 경계 11건 (53.0→1, 52.999→2, 48.5→4, 48.499→5, NULL→NULL)';
END $$;
