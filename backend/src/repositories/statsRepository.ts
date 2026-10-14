// 집계 읽기: stats_window(+patch), champion_tier_view, champion_item/rune/spell/skill (계약 v7)
// numeric·bigint는 SQL에서 ::int / ::float8로 바꿔 숫자로 받는다 (pg는 numeric을 문자열로 줌).
// 비율 반올림도 SQL round(numeric, 2)로 해서 뷰와 같은 방식으로 맞춘다.
import type { Queryable } from '../db/tx.js';

export interface WindowPatchRow {
  patch: string;
  games: number;
}

export interface WindowRow {
  days: number;
  windowStart: Date;
  windowEnd: Date;
  games: number;
  aggregatedAt: Date;
  /** 최신 패치 먼저 (patch_sort_key DESC) */
  patches: WindowPatchRow[];
}

/**
 * stats_window 1줄 + stats_window_patch를 **한 문장**으로 (스냅숏의 첫 문장). 집계 전(0줄)이면 null.
 * json_agg 안의 games는 json 숫자로 오므로 ::int로 맞춰 둔다.
 */
export async function readWindow(db: Queryable): Promise<WindowRow | null> {
  const r = await db.query<WindowRow>(
    `SELECT w.days::int        AS "days",
            w.window_start     AS "windowStart",
            w.window_end       AS "windowEnd",
            w.games::int       AS "games",
            w.aggregated_at    AS "aggregatedAt",
            coalesce(
              (SELECT json_agg(json_build_object('patch', p.patch, 'games', p.games::int)
                               ORDER BY patch_sort_key(p.patch) DESC)
                 FROM stats_window_patch p),
              '[]'::json)      AS "patches"
       FROM stats_window w
      WHERE w.id = 1`,
  );
  return r.rows[0] ?? null;
}

/** /health: DB 확인과 집계 시각을 한 문장으로 (SELECT 1 대신). 집계 전이면 null */
export async function readAggregatedAt(db: Queryable): Promise<Date | null> {
  const r = await db.query<{ aggregated_at: Date | null }>(
    `SELECT (SELECT aggregated_at FROM stats_window WHERE id = 1) AS aggregated_at`,
  );
  return r.rows[0]?.aggregated_at ?? null;
}

export interface TierRow {
  championId: number;
  position: string;
  pick: number;
  win: number;
  ban: number;
  winRate: number;
  pickRate: number;
  banRate: number;
  tierScore: number;
  tier: number | null;
  /** 그 챔피언 전체 pick 중 이 포지션 비율 % */
  positionShare: number;
}

const TIER_SELECT = `
  SELECT v.champion_id::int                AS "championId",
         v.position                        AS "position",
         v.pick::int                       AS "pick",
         v.win::int                        AS "win",
         v.ban::int                        AS "ban",
         v.win_rate::float8                AS "winRate",
         v.pick_rate::float8               AS "pickRate",
         v.ban_rate::float8                AS "banRate",
         v.tier_score::float8              AS "tierScore",
         v.tier::int                       AS "tier",
         round(100.0 * v.pick / sum(v.pick) OVER (PARTITION BY v.champion_id), 2)::float8 AS "positionShare"
    FROM champion_tier_view v`;

/** 창의 모든 챔피언 × 포지션. 티어리스트 정렬 순서 (tier NULLS LAST, tier_score DESC, champion_id) */
export async function tierRows(db: Queryable): Promise<TierRow[]> {
  const r = await db.query<TierRow>(
    `${TIER_SELECT}
     ORDER BY v.tier NULLS LAST, v.tier_score DESC, v.champion_id ASC, v.position ASC`,
  );
  return r.rows;
}

/** 한 챔피언의 모든 포지션 (pick 내림차순) */
export async function tierRowsForChampion(db: Queryable, championId: number): Promise<TierRow[]> {
  const r = await db.query<TierRow>(
    `${TIER_SELECT}
     WHERE v.champion_id = $1
     ORDER BY v.pick DESC, v.position ASC`,
    [championId],
  );
  return r.rows;
}

interface Key {
  championId: number;
  position: string;
}

export interface ItemRow {
  itemId: number;
  pick: number;
  win: number;
  winRate: number;
  pickRate: number;
}

export interface RuneRow {
  primaryStyle: number;
  primaryPerk1: number;
  primaryPerk2: number;
  primaryPerk3: number;
  primaryPerk4: number;
  subStyle: number;
  subPerk1: number;
  subPerk2: number;
  statOffense: number;
  statFlex: number;
  statDefense: number;
  pick: number;
  win: number;
  winRate: number;
  pickRate: number;
}

export interface SpellRow {
  spell1Id: number;
  spell2Id: number;
  pick: number;
  win: number;
  winRate: number;
  pickRate: number;
}

export interface SkillRow {
  skillOrder: string;
  pick: number;
  win: number;
  winRate: number;
  pickRate: number;
}

// 조합 승률 = win / pick, 사용률 = pick / champion.pick (계약 9-3)
const RATES = `
  round(100.0 * t.win / t.pick, 2)::float8 AS "winRate",
  round(100.0 * t.pick / c.pick, 2)::float8 AS "pickRate"`;
const JOIN_CHAMPION = `
  JOIN champion c ON c.champion_id = t.champion_id AND c.position = t.position
 WHERE t.champion_id = $1 AND t.position = $2`;

/** 모든 아이템, pick 내림차순 (결정 D4) */
export async function itemsFor(db: Queryable, k: Key): Promise<ItemRow[]> {
  const r = await db.query<ItemRow>(
    `SELECT t.item_id::int AS "itemId", t.pick::int AS "pick", t.win::int AS "win", ${RATES}
       FROM champion_item t ${JOIN_CHAMPION}
      ORDER BY t.pick DESC, t.win DESC, t.item_id ASC`,
    [k.championId, k.position],
  );
  return r.rows;
}

export async function runesFor(db: Queryable, k: Key, limit: number): Promise<RuneRow[]> {
  const r = await db.query<RuneRow>(
    `SELECT t.primary_style::int AS "primaryStyle",
            t.primary_perk1::int AS "primaryPerk1", t.primary_perk2::int AS "primaryPerk2",
            t.primary_perk3::int AS "primaryPerk3", t.primary_perk4::int AS "primaryPerk4",
            t.sub_style::int AS "subStyle", t.sub_perk1::int AS "subPerk1", t.sub_perk2::int AS "subPerk2",
            t.stat_offense::int AS "statOffense", t.stat_flex::int AS "statFlex", t.stat_defense::int AS "statDefense",
            t.pick::int AS "pick", t.win::int AS "win", ${RATES}
       FROM champion_rune t ${JOIN_CHAMPION}
      ORDER BY t.pick DESC, t.win DESC,
               t.primary_style, t.primary_perk1, t.primary_perk2, t.primary_perk3, t.primary_perk4,
               t.sub_style, t.sub_perk1, t.sub_perk2, t.stat_offense, t.stat_flex, t.stat_defense
      LIMIT $3`,
    [k.championId, k.position, limit],
  );
  return r.rows;
}

export async function spellsFor(db: Queryable, k: Key, limit: number): Promise<SpellRow[]> {
  const r = await db.query<SpellRow>(
    `SELECT t.spell1_id::int AS "spell1Id", t.spell2_id::int AS "spell2Id",
            t.pick::int AS "pick", t.win::int AS "win", ${RATES}
       FROM champion_spell t ${JOIN_CHAMPION}
      ORDER BY t.pick DESC, t.win DESC, t.spell1_id, t.spell2_id
      LIMIT $3`,
    [k.championId, k.position, limit],
  );
  return r.rows;
}

export async function skillsFor(db: Queryable, k: Key, limit: number): Promise<SkillRow[]> {
  const r = await db.query<SkillRow>(
    `SELECT t.skill_order AS "skillOrder", t.pick::int AS "pick", t.win::int AS "win", ${RATES}
       FROM champion_skill t ${JOIN_CHAMPION}
      ORDER BY t.pick DESC, t.win DESC, t.skill_order
      LIMIT $3`,
    [k.championId, k.position, limit],
  );
  return r.rows;
}
