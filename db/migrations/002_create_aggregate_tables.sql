-- 002: 집계 테이블 (patch → champion → 상세 4개)
-- 기준: docs/contracts/db_contract.dbml v4, db/docs/db_spec.md 4-5 ~ 4-7
-- 집계 테이블은 개수(pick, win, ban)만 저장한다. 비율·티어는 champion_tier_view(008)에서 계산한다.

CREATE TABLE patch (
  patch text NOT NULL,
  games int  NOT NULL,
  CONSTRAINT patch_pkey PRIMARY KEY (patch),
  CONSTRAINT patch_patch_check CHECK (patch ~ '^[0-9]+\.[0-9]+$'),
  CONSTRAINT patch_games_check CHECK (games > 0)
);

COMMENT ON TABLE patch IS '패치 1개 = 1줄. 픽률·밴률의 분모(그 패치의 전체 게임 수)';
COMMENT ON COLUMN patch.patch IS '패치 (예: 16.19)';
COMMENT ON COLUMN patch.games IS '이 패치에서 수집한 전체 게임 수 (match_players 10줄인 게임)';

CREATE TABLE champion (
  patch       text NOT NULL,
  champion_id int  NOT NULL,
  position    text NOT NULL,
  pick        int  NOT NULL,
  win         int  NOT NULL,
  ban         int  NOT NULL,
  CONSTRAINT champion_pkey PRIMARY KEY (patch, champion_id, position),
  CONSTRAINT champion_patch_fkey FOREIGN KEY (patch)
    REFERENCES patch (patch) ON DELETE CASCADE,
  CONSTRAINT champion_champion_id_check CHECK (champion_id > 0),
  CONSTRAINT champion_position_check
    CHECK (position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')),
  CONSTRAINT champion_pick_check CHECK (pick > 0),
  CONSTRAINT champion_win_check CHECK (win >= 0 AND win <= pick),
  CONSTRAINT champion_ban_check CHECK (ban >= 0)
);

COMMENT ON TABLE champion IS '패치 x 챔피언 x 포지션 = 1줄. 티어리스트 화면';
COMMENT ON COLUMN champion.champion_id IS '챔피언 (Data Dragon key, 예: 266)';
COMMENT ON COLUMN champion.position IS 'TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY';
COMMENT ON COLUMN champion.pick IS '이 포지션으로 고른 게임 수';
COMMENT ON COLUMN champion.win IS '그중 이긴 게임 수 (패배 = pick - win)';
COMMENT ON COLUMN champion.ban IS '이 챔피언이 밴된 게임 수. 포지션과 무관해서 같은 챔피언은 모든 포지션에 같은 값';

CREATE TABLE champion_item (
  patch       text NOT NULL,
  champion_id int  NOT NULL,
  position    text NOT NULL,
  item_id     int  NOT NULL,
  pick        int  NOT NULL,
  win         int  NOT NULL,
  CONSTRAINT champion_item_pkey PRIMARY KEY (patch, champion_id, position, item_id),
  CONSTRAINT champion_item_champion_fkey FOREIGN KEY (patch, champion_id, position)
    REFERENCES champion (patch, champion_id, position) ON DELETE CASCADE,
  CONSTRAINT champion_item_item_id_check CHECK (item_id > 0),
  CONSTRAINT champion_item_pick_check CHECK (pick > 0),
  CONSTRAINT champion_item_win_check CHECK (win >= 0 AND win <= pick)
);

COMMENT ON TABLE champion_item IS '챔피언 x 포지션별 아이템. item0~item5 를 한 줄 안 중복 없이 1개씩 센다 (빈 칸 0 제외, 하위 재료 포함, 모두 저장)';
COMMENT ON COLUMN champion_item.item_id IS '아이템 (Data Dragon item.json의 키)';
COMMENT ON COLUMN champion_item.pick IS '이 아이템을 가지고 끝난 게임 수';
COMMENT ON COLUMN champion_item.win IS '그중 이긴 게임 수';

CREATE TABLE champion_rune (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  patch         text NOT NULL,
  champion_id   int  NOT NULL,
  position      text NOT NULL,
  primary_style int  NOT NULL,
  primary_perk1 int  NOT NULL,
  primary_perk2 int  NOT NULL,
  primary_perk3 int  NOT NULL,
  primary_perk4 int  NOT NULL,
  sub_style     int  NOT NULL,
  sub_perk1     int  NOT NULL,
  sub_perk2     int  NOT NULL,
  stat_offense  int  NOT NULL,
  stat_flex     int  NOT NULL,
  stat_defense  int  NOT NULL,
  pick          int  NOT NULL,
  win           int  NOT NULL,
  CONSTRAINT champion_rune_pkey PRIMARY KEY (id),
  CONSTRAINT champion_rune_page_key UNIQUE (
    patch, champion_id, position,
    primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
    sub_style, sub_perk1, sub_perk2,
    stat_offense, stat_flex, stat_defense
  ),
  CONSTRAINT champion_rune_champion_fkey FOREIGN KEY (patch, champion_id, position)
    REFERENCES champion (patch, champion_id, position) ON DELETE CASCADE,
  CONSTRAINT champion_rune_pick_check CHECK (pick > 0),
  CONSTRAINT champion_rune_win_check CHECK (win >= 0 AND win <= pick)
);

COMMENT ON TABLE champion_rune IS '챔피언 x 포지션별 룬 페이지 조합 (트리 2개 + 룬 6개 + 파편 3개). 상위 10개만 저장';
COMMENT ON COLUMN champion_rune.pick IS '이 룬 페이지를 쓴 게임 수';
COMMENT ON COLUMN champion_rune.win IS '그중 이긴 게임 수';

CREATE TABLE champion_spell (
  patch       text NOT NULL,
  champion_id int  NOT NULL,
  position    text NOT NULL,
  spell1_id   int  NOT NULL,
  spell2_id   int  NOT NULL,
  pick        int  NOT NULL,
  win         int  NOT NULL,
  CONSTRAINT champion_spell_pkey PRIMARY KEY (patch, champion_id, position, spell1_id, spell2_id),
  CONSTRAINT champion_spell_champion_fkey FOREIGN KEY (patch, champion_id, position)
    REFERENCES champion (patch, champion_id, position) ON DELETE CASCADE,
  CONSTRAINT champion_spell_order_check CHECK (spell1_id < spell2_id),
  CONSTRAINT champion_spell_pick_check CHECK (pick > 0),
  CONSTRAINT champion_spell_win_check CHECK (win >= 0 AND win <= pick)
);

COMMENT ON TABLE champion_spell IS '챔피언 x 포지션별 소환사 주문 조합. D/F 위치와 무관하게 작은 번호 + 큰 번호. 상위 10개만 저장';
COMMENT ON COLUMN champion_spell.spell1_id IS '두 주문 중 작은 번호 (예: 4)';
COMMENT ON COLUMN champion_spell.spell2_id IS '두 주문 중 큰 번호 (예: 14)';
COMMENT ON COLUMN champion_spell.pick IS '이 조합을 쓴 게임 수';
COMMENT ON COLUMN champion_spell.win IS '그중 이긴 게임 수';

CREATE TABLE champion_skill (
  patch          text NOT NULL,
  champion_id    int  NOT NULL,
  position       text NOT NULL,
  skill_priority text NOT NULL,
  pick           int  NOT NULL,
  win            int  NOT NULL,
  CONSTRAINT champion_skill_pkey PRIMARY KEY (patch, champion_id, position, skill_priority),
  CONSTRAINT champion_skill_champion_fkey FOREIGN KEY (patch, champion_id, position)
    REFERENCES champion (patch, champion_id, position) ON DELETE CASCADE,
  CONSTRAINT champion_skill_skill_priority_check
    CHECK (skill_priority IN ('Q>W>E', 'Q>E>W', 'W>Q>E', 'W>E>Q', 'E>Q>W', 'E>W>Q')),
  CONSTRAINT champion_skill_pick_check CHECK (pick > 0),
  CONSTRAINT champion_skill_win_check CHECK (win >= 0 AND win <= pick)
);

COMMENT ON TABLE champion_skill IS '챔피언 x 포지션별 스킬 마스터 순서. skill_priority(skill_order)가 NULL이 아닌 줄만 센다';
COMMENT ON COLUMN champion_skill.skill_priority IS '스킬 마스터 순서 (예: Q>E>W)';
COMMENT ON COLUMN champion_skill.pick IS '이 순서로 찍은 게임 수';
COMMENT ON COLUMN champion_skill.win IS '그중 이긴 게임 수';
