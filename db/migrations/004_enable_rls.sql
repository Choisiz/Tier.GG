-- 004: RLS 켜기, 정책 없음, anon·authenticated 권한 회수 (db_spec 6장)
-- 정책을 만들지 않으므로 anon·authenticated는 0줄로 보이고 쓰기도 막힌다.
-- FORCE ROW LEVEL SECURITY는 쓰지 않는다 (테이블 주인인 백엔드까지 막히므로).
-- 스키마 전체 명령(ON ALL TABLES IN SCHEMA)은 쓰지 않고 이름을 하나씩 적는다.

ALTER TABLE ranked_players  ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches         ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players   ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE patch           ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion        ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion_item   ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion_rune   ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion_spell  ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion_skill  ENABLE ROW LEVEL SECURITY;

-- Supabase는 public 새 객체에 anon·authenticated 기본 권한을 주므로 2중 방어로 회수한다
REVOKE ALL ON ranked_players  FROM anon, authenticated;
REVOKE ALL ON matches         FROM anon, authenticated;
REVOKE ALL ON match_players   FROM anon, authenticated;
REVOKE ALL ON collection_logs FROM anon, authenticated;
REVOKE ALL ON patch           FROM anon, authenticated;
REVOKE ALL ON champion        FROM anon, authenticated;
REVOKE ALL ON champion_item   FROM anon, authenticated;
REVOKE ALL ON champion_rune   FROM anon, authenticated;
REVOKE ALL ON champion_spell  FROM anon, authenticated;
REVOKE ALL ON champion_skill  FROM anon, authenticated;

-- identity 시퀀스
REVOKE ALL ON SEQUENCE collection_logs_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE champion_rune_id_seq   FROM anon, authenticated;
