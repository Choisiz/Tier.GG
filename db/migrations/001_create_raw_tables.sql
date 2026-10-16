-- 001: 원본 테이블 (ranked_players → matches → match_players) + 운영 테이블 collection_logs
-- 기준: docs/contracts/db_contract.dbml v4, db/docs/db_spec.md 4장
-- 주의: public. 접두사를 쓰지 않는다 (fresh-check가 임시 스키마에 적용하므로)

-- ① 수집 대상 플레이어
CREATE TABLE ranked_players (
  puuid text NOT NULL,
  tier  text NOT NULL,
  rank  text NOT NULL,
  CONSTRAINT ranked_players_pkey PRIMARY KEY (puuid),
  CONSTRAINT ranked_players_tier_check
    CHECK (tier IN ('EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER')),
  CONSTRAINT ranked_players_rank_check
    CHECK (rank IN ('I', 'II', 'III', 'IV'))
);

COMMENT ON TABLE ranked_players IS '① 수집 대상 플레이어 (표본). 출처: league-v4 /lol/league/v4/entries/{queue}/{tier}/{division}, 마스터 이상은 masterleagues 등';
COMMENT ON COLUMN ranked_players.puuid IS 'puuid (마스터 이상은 entries[].puuid)';
COMMENT ON COLUMN ranked_players.tier IS 'tier (마스터 이상은 리스트 최상위 tier). EMERALD | DIAMOND | MASTER | GRANDMASTER | CHALLENGER';
COMMENT ON COLUMN ranked_players.rank IS 'rank. I | II | III | IV';

-- ② 게임 1개 = 1줄
CREATE TABLE matches (
  match_id text NOT NULL,
  puuid    text,
  patch    text NOT NULL,
  CONSTRAINT matches_pkey PRIMARY KEY (match_id),
  CONSTRAINT matches_puuid_fkey FOREIGN KEY (puuid)
    REFERENCES ranked_players (puuid) ON DELETE SET NULL,
  CONSTRAINT matches_match_id_check CHECK (match_id ~ '^KR_[0-9]+$'),
  CONSTRAINT matches_patch_check CHECK (patch ~ '^[0-9]+\.[0-9]+$')
);

COMMENT ON TABLE matches IS '② 게임 1개 = 1줄. 출처: match-v5 /lol/match/v5/matches/by-puuid/{puuid}/ids?queue=420 + /lol/match/v5/matches/{matchId}';
COMMENT ON COLUMN matches.match_id IS 'metadata.matchId (목록 응답의 각 항목, 예: KR_8408851980)';
COMMENT ON COLUMN matches.puuid IS '이 게임 ID를 찾을 때 조회한 표본 플레이어 (by-puuid 요청의 puuid). 여러 명이면 처음 찾은 1명';
COMMENT ON COLUMN matches.patch IS 'info.gameVersion 앞 두 부분 (16.19.823.722 → 16.19)';

-- ③ 게임 속 플레이어 1명 = 1줄 (게임당 10줄)
CREATE TABLE match_players (
  match_id        text    NOT NULL,
  puuid           text    NOT NULL,
  champion_id     int     NOT NULL,
  team_position   text,
  win             boolean NOT NULL,
  ban_champion_id int,

  summoner1_id    int     NOT NULL,
  summoner2_id    int     NOT NULL,

  primary_style   int     NOT NULL,
  primary_perk1   int     NOT NULL,
  primary_perk2   int     NOT NULL,
  primary_perk3   int     NOT NULL,
  primary_perk4   int     NOT NULL,
  sub_style       int     NOT NULL,
  sub_perk1       int     NOT NULL,
  sub_perk2       int     NOT NULL,
  stat_offense    int     NOT NULL,
  stat_flex       int     NOT NULL,
  stat_defense    int     NOT NULL,

  item0           int,
  item1           int,
  item2           int,
  item3           int,
  item4           int,
  item5           int,

  skill_order     text,

  CONSTRAINT match_players_pkey PRIMARY KEY (match_id, puuid),
  CONSTRAINT match_players_match_id_fkey FOREIGN KEY (match_id)
    REFERENCES matches (match_id) ON DELETE CASCADE,
  CONSTRAINT match_players_champion_id_check CHECK (champion_id > 0),
  CONSTRAINT match_players_team_position_check
    CHECK (team_position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')),
  CONSTRAINT match_players_ban_champion_id_check CHECK (ban_champion_id > 0),
  CONSTRAINT match_players_summoner1_id_check CHECK (summoner1_id > 0),
  CONSTRAINT match_players_summoner2_id_check CHECK (summoner2_id > 0),
  CONSTRAINT match_players_item0_check CHECK (item0 >= 0),
  CONSTRAINT match_players_item1_check CHECK (item1 >= 0),
  CONSTRAINT match_players_item2_check CHECK (item2 >= 0),
  CONSTRAINT match_players_item3_check CHECK (item3 >= 0),
  CONSTRAINT match_players_item4_check CHECK (item4 >= 0),
  CONSTRAINT match_players_item5_check CHECK (item5 >= 0),
  CONSTRAINT match_players_skill_order_check CHECK (skill_order ~ '^[QWER]*$')
);

COMMENT ON TABLE match_players IS '③ 게임 속 플레이어 1명 = 1줄 (게임당 10줄). 출처: match-v5 getMatch info.participants[] + info.teams[].bans[] + timeline SKILL_LEVEL_UP';
COMMENT ON COLUMN match_players.match_id IS 'metadata.matchId';
COMMENT ON COLUMN match_players.puuid IS 'info.participants[].puuid (표본 플레이어가 아닐 수 있음)';
COMMENT ON COLUMN match_players.champion_id IS 'info.participants[].championId (예: 23)';
COMMENT ON COLUMN match_players.team_position IS 'info.participants[].teamPosition. TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY, 빈 문자열은 NULL';
COMMENT ON COLUMN match_players.win IS 'info.participants[].win';
COMMENT ON COLUMN match_players.ban_champion_id IS 'info.teams[].bans[] 중 pickTurn = participants[].participantId 인 항목의 championId. -1(밴 없음)은 NULL';
COMMENT ON COLUMN match_players.summoner1_id IS 'info.participants[].summoner1Id (D, 예: 14)';
COMMENT ON COLUMN match_players.summoner2_id IS 'info.participants[].summoner2Id (F, 예: 4)';
COMMENT ON COLUMN match_players.primary_style IS 'perks.styles[0].style (예: 8100)';
COMMENT ON COLUMN match_players.primary_perk1 IS 'perks.styles[0].selections[0].perk (예: 9923)';
COMMENT ON COLUMN match_players.primary_perk2 IS 'perks.styles[0].selections[1].perk (예: 8143)';
COMMENT ON COLUMN match_players.primary_perk3 IS 'perks.styles[0].selections[2].perk (예: 8140)';
COMMENT ON COLUMN match_players.primary_perk4 IS 'perks.styles[0].selections[3].perk (예: 8135)';
COMMENT ON COLUMN match_players.sub_style IS 'perks.styles[1].style (예: 8000)';
COMMENT ON COLUMN match_players.sub_perk1 IS 'perks.styles[1].selections[0].perk (예: 8299)';
COMMENT ON COLUMN match_players.sub_perk2 IS 'perks.styles[1].selections[1].perk (예: 9104)';
COMMENT ON COLUMN match_players.stat_offense IS 'perks.statPerks.offense (예: 5008)';
COMMENT ON COLUMN match_players.stat_flex IS 'perks.statPerks.flex (예: 5008)';
COMMENT ON COLUMN match_players.stat_defense IS 'perks.statPerks.defense (예: 5011)';
COMMENT ON COLUMN match_players.item0 IS 'info.participants[].item0, 빈 칸 0 (예: 1018)';
COMMENT ON COLUMN match_players.item1 IS 'info.participants[].item1, 빈 칸 0 (예: 3074)';
COMMENT ON COLUMN match_players.item2 IS 'info.participants[].item2, 빈 칸 0 (예: 3006)';
COMMENT ON COLUMN match_players.item3 IS 'info.participants[].item3, 빈 칸 0 (예: 3046)';
COMMENT ON COLUMN match_players.item4 IS 'info.participants[].item4, 빈 칸 0 (예: 1036)';
COMMENT ON COLUMN match_players.item5 IS 'info.participants[].item5, 빈 칸 0 (예: 1036)';
COMMENT ON COLUMN match_players.skill_order IS 'timeline info.frames[].events[] 중 type = SKILL_LEVEL_UP, levelUpType = NORMAL 의 skillSlot (1=Q 2=W 3=E 4=R) 을 timestamp 순으로 이어 붙임 (예: EQQWQRQEQEREEW)';

-- 운영: 수집 실행 1회 = 1줄
CREATE TABLE collection_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL,
  players       int,
  matches_saved int,
  error_message text,
  CONSTRAINT collection_logs_pkey PRIMARY KEY (id),
  CONSTRAINT collection_logs_finished_at_check
    CHECK (finished_at IS NULL OR finished_at >= started_at),
  CONSTRAINT collection_logs_status_check
    CHECK (status IN ('running', 'done', 'key_expired', 'failed')),
  CONSTRAINT collection_logs_players_check CHECK (players >= 0),
  CONSTRAINT collection_logs_matches_saved_check CHECK (matches_saved >= 0)
);

COMMENT ON TABLE collection_logs IS '수집 실행 1회 = 1줄. 다른 테이블과 연결하지 않음';
COMMENT ON COLUMN collection_logs.started_at IS '시작 시각';
COMMENT ON COLUMN collection_logs.finished_at IS '끝난 시각. 실행 중이면 NULL';
COMMENT ON COLUMN collection_logs.status IS 'running | done | key_expired | failed';
COMMENT ON COLUMN collection_logs.players IS '조회한 표본 플레이어 수';
COMMENT ON COLUMN collection_logs.matches_saved IS '새로 저장한 게임 수';
COMMENT ON COLUMN collection_logs.error_message IS '실패했을 때 오류 내용';
