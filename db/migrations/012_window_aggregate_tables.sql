-- 012: 집계 구조를 패치 단위 → 최근 14일 창 스냅숏 1개로 (db_spec 변경 03, 03-3-1, 03-4, D13 = (a), D18 = (a))
-- - 옛 뷰·함수·집계 테이블 6개를 지우고, stats_window·stats_window_patch와 patch 컬럼 없는 집계 5개를 새로 만든다.
-- - 되돌릴 수 없는 DROP (사용자 승인 2026-10-14, 03-10 2~4번). 지우는 집계는 26게임에서 나온 파생값이다.
-- - 안전장치가 걸리면 이 파일 전체가 ROLLBACK되고 실행기가 멈춘다.
-- - patch_sort_key, tier_from_score는 남긴다.
-- 주의: public. 접두사를 쓰지 않는다 (fresh-check가 임시 스키마에 적용하므로)

-- 1. 안전장치: 테스트 집계(26게임)만 있을 때만 진행
DO $$
DECLARE
  v_games bigint;
BEGIN
  SELECT coalesce(sum(games), 0) INTO v_games FROM patch;
  IF v_games > 26 THEN
    RAISE EXCEPTION '012: 집계 게임 수 합계가 %로 예상(26 이하)보다 많아 중단합니다. 아무것도 지우지 않았습니다.', v_games;
  END IF;
END $$;

-- 2. 옛 뷰 (champion·patch에 의존)
DROP VIEW champion_tier_view;

-- 3. 옛 함수 (없는 테이블을 가리키게 되므로 함께 지운다)
DROP FUNCTION refresh_patch_stats(text);
DROP FUNCTION purge_old_patches(integer);

-- 4. 옛 집계 테이블 (상세 → champion → patch 순)
DROP TABLE champion_skill, champion_spell, champion_rune, champion_item, champion, patch;

-- 5. 새 집계 테이블

-- 창 정보 (항상 0줄 또는 1줄)
CREATE TABLE stats_window (
  id            smallint    NOT NULL DEFAULT 1,
  days          int         NOT NULL,
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  games         int         NOT NULL,
  aggregated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stats_window_pkey PRIMARY KEY (id),
  CONSTRAINT stats_window_id_check CHECK (id = 1),
  CONSTRAINT stats_window_days_check CHECK (days BETWEEN 1 AND 60),
  CONSTRAINT stats_window_range_check CHECK (window_start < window_end),
  CONSTRAINT stats_window_games_check CHECK (games > 0)
);

COMMENT ON TABLE stats_window IS '현재 집계 창 1개 = 1줄 (집계 전에는 0줄). 픽률·밴률의 분모(창 안의 전체 게임 수). 대상: window_start <= game_start_at < window_end 이고 match_players 10줄인 게임';
COMMENT ON COLUMN stats_window.id IS '항상 1. CHECK id = 1';
COMMENT ON COLUMN stats_window.days IS '창 길이(일). 기본 14. CHECK 1~60';
COMMENT ON COLUMN stats_window.window_start IS '창 시작 (포함) = window_end - days x 24시간';
COMMENT ON COLUMN stats_window.window_end IS '창 끝 (제외). 보통 집계한 시각';
COMMENT ON COLUMN stats_window.games IS '창 안의 완료 게임 수 (픽률·밴률 분모)';
COMMENT ON COLUMN stats_window.aggregated_at IS '집계한 시각';

-- 창 안 패치 구성
CREATE TABLE stats_window_patch (
  patch text NOT NULL,
  games int  NOT NULL,
  CONSTRAINT stats_window_patch_pkey PRIMARY KEY (patch),
  CONSTRAINT stats_window_patch_patch_check CHECK (patch ~ '^[0-9]+\.[0-9]+$'),
  CONSTRAINT stats_window_patch_games_check CHECK (games > 0)
);

COMMENT ON TABLE stats_window_patch IS '창 안의 패치 1개 = 1줄. 화면의 패치 구성 (예: 16.19 40% / 16.20 60%). 비율은 저장하지 않는다 (백엔드가 games / stats_window.games 로 계산). games 합계 = stats_window.games';
COMMENT ON COLUMN stats_window_patch.patch IS '패치 (예: 16.20). matches.patch 값';
COMMENT ON COLUMN stats_window_patch.games IS '창 안에서 이 패치의 완료 게임 수';

CREATE TABLE champion (
  champion_id int  NOT NULL,
  position    text NOT NULL,
  pick        int  NOT NULL,
  win         int  NOT NULL,
  ban         int  NOT NULL,
  CONSTRAINT champion_pkey PRIMARY KEY (champion_id, position),
  CONSTRAINT champion_champion_id_check CHECK (champion_id > 0),
  CONSTRAINT champion_position_check
    CHECK (position IN ('TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY')),
  CONSTRAINT champion_pick_check CHECK (pick > 0),
  CONSTRAINT champion_win_check CHECK (win >= 0 AND win <= pick),
  CONSTRAINT champion_ban_check CHECK (ban >= 0)
);

COMMENT ON TABLE champion IS '챔피언 x 포지션 = 1줄 (현재 창). 티어리스트 화면';
COMMENT ON COLUMN champion.champion_id IS '챔피언 (Data Dragon key, 예: 266)';
COMMENT ON COLUMN champion.position IS 'TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY';
COMMENT ON COLUMN champion.pick IS '이 포지션으로 고른 게임 수';
COMMENT ON COLUMN champion.win IS '그중 이긴 게임 수 (패배 = pick - win)';
COMMENT ON COLUMN champion.ban IS '이 챔피언이 밴된 게임 수. 포지션과 무관해서 같은 챔피언은 모든 포지션에 같은 값';

CREATE TABLE champion_item (
  champion_id int  NOT NULL,
  position    text NOT NULL,
  item_id     int  NOT NULL,
  pick        int  NOT NULL,
  win         int  NOT NULL,
  CONSTRAINT champion_item_pkey PRIMARY KEY (champion_id, position, item_id),
  CONSTRAINT champion_item_champion_fkey FOREIGN KEY (champion_id, position)
    REFERENCES champion (champion_id, position) ON DELETE CASCADE,
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
    champion_id, position,
    primary_style, primary_perk1, primary_perk2, primary_perk3, primary_perk4,
    sub_style, sub_perk1, sub_perk2,
    stat_offense, stat_flex, stat_defense
  ),
  CONSTRAINT champion_rune_champion_fkey FOREIGN KEY (champion_id, position)
    REFERENCES champion (champion_id, position) ON DELETE CASCADE,
  CONSTRAINT champion_rune_pick_check CHECK (pick > 0),
  CONSTRAINT champion_rune_win_check CHECK (win >= 0 AND win <= pick)
);

COMMENT ON TABLE champion_rune IS '챔피언 x 포지션별 룬 페이지 조합 (트리 2개 + 룬 6개 + 파편 3개). 상위 10개만 저장';
COMMENT ON COLUMN champion_rune.pick IS '이 룬 페이지를 쓴 게임 수';
COMMENT ON COLUMN champion_rune.win IS '그중 이긴 게임 수';

CREATE TABLE champion_spell (
  champion_id int  NOT NULL,
  position    text NOT NULL,
  spell1_id   int  NOT NULL,
  spell2_id   int  NOT NULL,
  pick        int  NOT NULL,
  win         int  NOT NULL,
  CONSTRAINT champion_spell_pkey PRIMARY KEY (champion_id, position, spell1_id, spell2_id),
  CONSTRAINT champion_spell_champion_fkey FOREIGN KEY (champion_id, position)
    REFERENCES champion (champion_id, position) ON DELETE CASCADE,
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
  champion_id int  NOT NULL,
  position    text NOT NULL,
  skill_order text NOT NULL,
  pick        int  NOT NULL,
  win         int  NOT NULL,
  CONSTRAINT champion_skill_pkey PRIMARY KEY (champion_id, position, skill_order),
  CONSTRAINT champion_skill_champion_fkey FOREIGN KEY (champion_id, position)
    REFERENCES champion (champion_id, position) ON DELETE CASCADE,
  CONSTRAINT champion_skill_skill_order_check CHECK (skill_order ~ '^[QWER]{11}$'),
  CONSTRAINT champion_skill_pick_check CHECK (pick > 0),
  CONSTRAINT champion_skill_win_check CHECK (win >= 0 AND win <= pick)
);

COMMENT ON TABLE champion_skill IS '챔피언 x 포지션별 스킬 찍은 순서 앞 11레벨. skill_order가 11자 이상인 줄만 앞 11글자로 센다. 상위 10개만 저장';
COMMENT ON COLUMN champion_skill.skill_order IS '스킬 찍은 순서 앞 11레벨 (예: EQQWQRQEQEREEW → EQQWQRQEQER)';
COMMENT ON COLUMN champion_skill.pick IS '이 순서로 찍은 게임 수';
COMMENT ON COLUMN champion_skill.win IS '그중 이긴 게임 수';

-- 6. RLS 켜기, 정책 없음 (004와 같은 방식, FORCE 아님)
ALTER TABLE stats_window       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stats_window_patch ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion           ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion_item      ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion_rune      ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion_spell     ENABLE ROW LEVEL SECURITY;
ALTER TABLE champion_skill     ENABLE ROW LEVEL SECURITY;

-- 7. Supabase 기본 권한(pg_default_acl) 회수 (L2: 새 객체마다 이름을 적어 REVOKE)
REVOKE ALL ON stats_window       FROM anon, authenticated;
REVOKE ALL ON stats_window_patch FROM anon, authenticated;
REVOKE ALL ON champion           FROM anon, authenticated;
REVOKE ALL ON champion_item      FROM anon, authenticated;
REVOKE ALL ON champion_rune      FROM anon, authenticated;
REVOKE ALL ON champion_spell     FROM anon, authenticated;
REVOKE ALL ON champion_skill     FROM anon, authenticated;
REVOKE ALL ON SEQUENCE champion_rune_id_seq FROM anon, authenticated;
