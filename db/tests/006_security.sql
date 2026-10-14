-- 006: RLS / 권한 (db_spec 6장, 8-2, 변경 03 03-6 D19 / db_review L2)
-- 손으로 적은 목록 대신 current_schema()의 모든 테이블·뷰·시퀀스와 모든 함수(확장 소속 제외)를 자동으로 검사한다.
--   테이블: RLS 켜짐, FORCE 아님, 정책 0개, 주인 = 실행 역할, anon·authenticated 권한 없음
--   뷰: anon·authenticated 권한 없음, security_invoker = true
--   시퀀스: anon·authenticated USAGE/SELECT/UPDATE 없음
--   함수: anon·authenticated·PUBLIC EXECUTE 없음
-- 기대 개수 (변경 03 뒤): 테이블 11 (+ public이면 schema_migrations), 뷰 1, 시퀀스 2, 함수 4
DO $$
DECLARE
  v_schema text := current_schema();
  v_public boolean := current_schema() = 'public';
  v_tables int := 0;
  v_views int := 0;
  v_seqs int := 0;
  v_funcs int := 0;
  o record;
  role_name text;
  v_n int;
  v_roles text[] := ARRAY[]::text[];
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      v_roles := v_roles || role_name;
    ELSE
      RAISE NOTICE '[건너뜀] 역할 % 없음', role_name;
    END IF;
  END LOOP;

  -- 테이블·뷰·시퀀스 (확장 소속 제외)
  FOR o IN
    SELECT c.oid, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relowner, c.reloptions
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = v_schema
      AND c.relkind IN ('r', 'v', 'S', 'm', 'p', 'f')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ORDER BY c.relkind, c.relname
  LOOP
    IF o.relkind IN ('m', 'p', 'f') THEN
      RAISE EXCEPTION '예상하지 않은 객체 종류 % : %', o.relkind, o.relname;
    END IF;

    IF o.relkind = 'r' THEN
      v_tables := v_tables + 1;
      IF NOT (o.relrowsecurity AND NOT o.relforcerowsecurity) THEN
        RAISE EXCEPTION 'RLS 설정 오류: %', o.relname;
      END IF;
      SELECT count(*) INTO v_n FROM pg_policy WHERE polrelid = o.oid;
      IF v_n <> 0 THEN RAISE EXCEPTION '정책이 있음: % (%개)', o.relname, v_n; END IF;
      IF o.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user) THEN
        RAISE EXCEPTION '주인이 실행 역할이 아님: %', o.relname;
      END IF;
    ELSIF o.relkind = 'v' THEN
      v_views := v_views + 1;
      IF o.reloptions IS NULL OR NOT ('security_invoker=true' = ANY (o.reloptions)) THEN
        RAISE EXCEPTION '뷰 security_invoker 가 꺼져 있음: %', o.relname;
      END IF;
    ELSE
      v_seqs := v_seqs + 1;
    END IF;

    FOREACH role_name IN ARRAY v_roles LOOP
      IF o.relkind IN ('r', 'v') THEN
        IF has_table_privilege(role_name, o.oid, 'SELECT') OR has_table_privilege(role_name, o.oid, 'INSERT')
           OR has_table_privilege(role_name, o.oid, 'UPDATE') OR has_table_privilege(role_name, o.oid, 'DELETE')
           OR has_table_privilege(role_name, o.oid, 'TRUNCATE') OR has_table_privilege(role_name, o.oid, 'REFERENCES')
           OR has_table_privilege(role_name, o.oid, 'TRIGGER') THEN
          RAISE EXCEPTION '% 가 % 권한을 가짐', role_name, o.relname;
        END IF;
      ELSE
        IF has_sequence_privilege(role_name, o.oid, 'USAGE') OR has_sequence_privilege(role_name, o.oid, 'SELECT')
           OR has_sequence_privilege(role_name, o.oid, 'UPDATE') THEN
          RAISE EXCEPTION '% 가 시퀀스 % 권한을 가짐', role_name, o.relname;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- 함수 (확장 소속 제외)
  FOR o IN
    SELECT p.oid, p.oid::regprocedure::text AS sig, p.proacl
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = v_schema
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
    ORDER BY 2
  LOOP
    v_funcs := v_funcs + 1;
    FOREACH role_name IN ARRAY v_roles LOOP
      IF has_function_privilege(role_name, o.oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% 가 % EXECUTE 권한을 가짐', role_name, o.sig;
      END IF;
    END LOOP;
    -- PUBLIC 의 EXECUTE: proacl 에 '=X' (PUBLIC 항목)가 없어야 함 (NULL acl 은 기본값 = PUBLIC 실행 가능이므로 실패)
    IF o.proacl IS NULL OR EXISTS (SELECT 1 FROM unnest(o.proacl) a WHERE a::text LIKE '=%X%') THEN
      RAISE EXCEPTION 'PUBLIC 이 % 를 실행할 수 있음', o.sig;
    END IF;
  END LOOP;

  RAISE NOTICE '[결과] 검사한 객체 (스키마 %): 테이블 %, 뷰 %, 시퀀스 %, 함수 %', v_schema, v_tables, v_views, v_seqs, v_funcs;
  RAISE NOTICE '[결과] 함수 목록: %', (SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = v_schema
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'));

  -- 기대 개수 (객체가 빠지거나 몰래 늘지 않았는지)
  v_n := 11;
  IF v_public AND to_regclass('public.schema_migrations') IS NOT NULL THEN v_n := 12; END IF;
  IF v_tables <> v_n
     OR v_views <> 1 OR v_seqs <> 2 OR v_funcs <> 4 THEN
    RAISE EXCEPTION '객체 개수 불일치: 테이블 %, 뷰 %, 시퀀스 %, 함수 % (기대 11(+schema_migrations), 1, 2, 4)',
      v_tables, v_views, v_seqs, v_funcs;
  END IF;
  RAISE NOTICE '[통과] 테이블: RLS 켜짐·FORCE 아님·정책 0개·주인 = 실행 역할. anon·authenticated: 테이블·뷰·시퀀스·함수 권한 없음. PUBLIC: 함수 EXECUTE 없음. 뷰 security_invoker = true';
END $$;
