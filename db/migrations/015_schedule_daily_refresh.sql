-- 015: 매일 05:00 KST(20:00 UTC) 집계 예약 작업 (db_spec 변경 03, 03-11, D23)
-- - 지속 설정 (사용자 승인 2026-10-14, 03-10 6·7번): pg_cron 확장 켜기, 작업 tiergg_daily_refresh 등록
-- - 멈추려면: SELECT cron.unschedule('tiergg_daily_refresh');
-- - 접속 계정 권한으로 확장을 켤 수 없으면 이 파일 전체가 ROLLBACK된다.
--   그때는 대시보드(Integrations → Cron)에서 켠 뒤 이 파일을 그대로 다시 적용한다 (IF NOT EXISTS).
-- - public에 객체를 만들지 않는다. 함수 이름은 스키마 없이 적는다 (작업은 기본 search_path로 돈다).

-- Supabase 안내대로 pg_catalog 스키마에 켠다 (작업 테이블·함수는 cron 스키마에 생김)
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- 같은 이름의 작업이 있으면 지우고 다시 등록 (몇 번 적용해도 1개)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'tiergg_daily_refresh';

SELECT cron.schedule(
  'tiergg_daily_refresh',
  '0 20 * * *',   -- pg_cron은 UTC(GMT) 기준. 20:00 UTC = 다음 날 05:00 KST
  $cmd$SET statement_timeout = '5min'; ANALYZE matches, match_players; SELECT refresh_window_stats(14);$cmd$
);
