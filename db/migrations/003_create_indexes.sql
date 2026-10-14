-- 003: 인덱스 (dbml v4의 1개만)
-- 나머지 조회는 PK·유니크 키가 대신한다 (db_spec 5장)

CREATE INDEX match_players_champion_id_team_position_idx
  ON match_players (champion_id, team_position);
