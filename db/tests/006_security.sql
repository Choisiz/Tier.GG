-- 006: RLS / 권한 (db_spec 6장, 8-2)
DO $$
DECLARE
  v_tables text[] := ARRAY['ranked_players','matches','match_players','collection_logs',
                           'patch','champion','champion_item','champion_rune','champion_spell','champion_skill'];
  v_funcs text[] := ARRAY['patch_sort_key(text)','tier_from_score(numeric)',
                          'refresh_patch_stats(text)','purge_old_patches(integer)'];
  t text;
  f text;
  role_name text;
  v_n int;
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL AND current_setting('search_path') LIKE 'public%' THEN
    v_tables := v_tables || 'schema_migrations'::text;
  END IF;

  FOREACH t IN ARRAY v_tables LOOP
    IF NOT (SELECT relrowsecurity AND NOT relforcerowsecurity FROM pg_class WHERE oid = t::regclass) THEN
      RAISE EXCEPTION 'RLS 설정 오류: %', t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policy WHERE polrelid = t::regclass;
    IF v_n <> 0 THEN RAISE EXCEPTION '정책이 있음: % (%개)', t, v_n; END IF;
    IF (SELECT relowner FROM pg_class WHERE oid = t::regclass) <> (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN
      RAISE EXCEPTION '주인이 실행 역할이 아님: %', t;
    END IF;
  END LOOP;
  RAISE NOTICE '[통과] 테이블 %개: RLS 켜짐, FORCE 아님, 정책 0개, 주인 = 실행 역할', array_length(v_tables, 1);

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      RAISE NOTICE '[건너뜀] 역할 % 없음', role_name;
      CONTINUE;
    END IF;
    FOREACH t IN ARRAY v_tables || 'champion_tier_view'::text LOOP
      IF has_table_privilege(role_name, t, 'SELECT') OR has_table_privilege(role_name, t, 'INSERT')
         OR has_table_privilege(role_name, t, 'UPDATE') OR has_table_privilege(role_name, t, 'DELETE') THEN
        RAISE EXCEPTION '% 가 % 권한을 가짐', role_name, t;
      END IF;
    END LOOP;
    FOREACH f IN ARRAY v_funcs LOOP
      IF has_function_privilege(role_name, f, 'EXECUTE') THEN
        RAISE EXCEPTION '% 가 % EXECUTE 권한을 가짐', role_name, f;
      END IF;
    END LOOP;
    IF has_sequence_privilege(role_name, 'collection_logs_id_seq', 'USAGE')
       OR has_sequence_privilege(role_name, 'champion_rune_id_seq', 'USAGE') THEN
      RAISE EXCEPTION '% 가 시퀀스 USAGE 권한을 가짐', role_name;
    END IF;
  END LOOP;
  RAISE NOTICE '[통과] anon·authenticated: 테이블·뷰 SELECT/INSERT/UPDATE/DELETE 없음, 함수 4개 EXECUTE 없음, 시퀀스 USAGE 없음';

  -- PUBLIC 의 EXECUTE: proacl 에 '=X' (PUBLIC 항목)가 없어야 함 (NULL acl 은 기본값 = PUBLIC 실행 가능이므로 실패)
  FOREACH f IN ARRAY v_funcs LOOP
    IF (SELECT proacl IS NULL OR EXISTS (SELECT 1 FROM unnest(proacl) a WHERE a::text LIKE '=%X%')
        FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION 'PUBLIC 이 % 를 실행할 수 있음', f;
    END IF;
  END LOOP;
  RAISE NOTICE '[통과] PUBLIC: 함수 4개 EXECUTE 없음';

  IF NOT (SELECT 'security_invoker=true' = ANY (reloptions) FROM pg_class WHERE oid = 'champion_tier_view'::regclass) THEN
    RAISE EXCEPTION '뷰 security_invoker 가 꺼져 있음';
  END IF;
  RAISE NOTICE '[통과] champion_tier_view reloptions = %', (SELECT reloptions FROM pg_class WHERE oid = 'champion_tier_view'::regclass);
END $$;
