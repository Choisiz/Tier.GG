-- 011: 매일 집계 예약 작업 tiergg_daily_refresh (db_spec 변경 03, 03-11). 항상 ROLLBACK. 작업을 실행하지 않는다.
--   확장 pg_cron 있음 / cron.job에 tiergg_daily_refresh 정확히 1줄 / schedule '0 20 * * *', active
--   command = 015 문구 / username = current_user, database = current_database()
--   anon·authenticated: cron 스키마 USAGE 없음 (실패 조건), cron.schedule·cron.unschedule에 직접 준 EXECUTE 없음 (실패 조건)
--   PUBLIC EXECUTE(pg_cron 기본값)는 [주의]로만 남긴다 (Build 편차, 변경 03 db_build 참고)
DO $$
DECLARE
  v_cmd constant text := $cmd$SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);$cmd$;
  j record;
  v_n int;
  role_name text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron 확장이 없음 (015 미적용)';
  END IF;
  RAISE NOTICE '[통과] pg_cron 확장 %', (SELECT extversion FROM pg_extension WHERE extname = 'pg_cron');

  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'tiergg_daily_refresh';
  IF v_n <> 1 THEN RAISE EXCEPTION 'tiergg_daily_refresh 작업 수 % <> 1', v_n; END IF;

  SELECT * INTO j FROM cron.job WHERE jobname = 'tiergg_daily_refresh';
  IF j.schedule <> '0 20 * * *' OR NOT j.active THEN
    RAISE EXCEPTION '일정 불일치: schedule %, active %', j.schedule, j.active;
  END IF;
  IF j.command <> v_cmd THEN
    RAISE EXCEPTION '명령 불일치: %', j.command;
  END IF;
  IF j.username <> current_user OR j.database <> current_database() THEN
    RAISE EXCEPTION '실행 계정 불일치: username %, database %', j.username, j.database;
  END IF;
  RAISE NOTICE '[통과] 작업 1개: jobid %, schedule %, active %, username %, database %', j.jobid, j.schedule, j.active, j.username, j.database;
  RAISE NOTICE '[통과] command = %', j.command;

  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      RAISE NOTICE '[건너뜀] 역할 % 없음', role_name;
      CONTINUE;
    END IF;
    IF has_schema_privilege(role_name, 'cron', 'USAGE') THEN
      RAISE EXCEPTION '% 가 cron 스키마 USAGE 권한을 가짐', role_name;
    END IF;
    -- 함수 EXECUTE: 역할에 직접 준 권한이 있으면 실패.
    -- pg_cron 기본값으로 PUBLIC에 EXECUTE가 있지만(확장 소속, 마이그레이션에서 바꾸지 않음 03-11 보안),
    -- cron 스키마 USAGE가 없어 실제로는 부를 수 없다. 이 경우는 [주의]로 남기고 Build 기록에 보고한다.
    IF EXISTS (
      SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.oid IN ('cron.schedule(text,text,text)'::regprocedure, 'cron.unschedule(bigint)'::regprocedure)
        AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = role_name) AND a.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION '% 에 cron.schedule/unschedule EXECUTE 권한이 직접 주어짐', role_name;
    END IF;
    IF has_function_privilege(role_name, 'cron.schedule(text,text,text)', 'EXECUTE')
       OR has_function_privilege(role_name, 'cron.unschedule(bigint)', 'EXECUTE') THEN
      RAISE NOTICE '[주의] % : cron.schedule/unschedule EXECUTE가 PUBLIC으로 있음 (pg_cron 기본값). cron 스키마 USAGE가 없어 호출 불가', role_name;
    END IF;
  END LOOP;
  RAISE NOTICE '[통과] anon·authenticated: cron 스키마 USAGE 없음, cron.schedule·cron.unschedule에 직접 준 EXECUTE 없음';
END $$;
