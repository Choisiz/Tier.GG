// 원본 테이블: ranked_players upsert, matches/match_players 저장, 이미 있는 ID 조회
import type { Queryable } from '../db/tx.js';
import type { MatchRow, PlayerRow } from '../collector/transform.js';

export interface SamplePlayer {
  puuid: string;
  tier: string;
  rank: string;
}

export async function upsertRankedPlayers(db: Queryable, rows: SamplePlayer[]): Promise<number> {
  if (rows.length === 0) return 0;
  const r = await db.query(
    `INSERT INTO ranked_players (puuid, tier, rank)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (puuid) DO UPDATE SET tier = EXCLUDED.tier, rank = EXCLUDED.rank`,
    [rows.map((r) => r.puuid), rows.map((r) => r.tier), rows.map((r) => r.rank)],
  );
  return r.rowCount ?? 0;
}

export async function countRankedPlayersByTier(db: Queryable, tiers: string[]): Promise<Map<string, number>> {
  const r = await db.query<{ tier: string; n: number }>(
    `SELECT tier, count(*)::int AS n FROM ranked_players WHERE tier = ANY($1::text[]) GROUP BY tier`,
    [tiers],
  );
  return new Map(r.rows.map((x) => [x.tier, x.n]));
}

export async function listSamplePuuids(db: Queryable, tiers: string[]): Promise<string[]> {
  const r = await db.query<{ puuid: string }>(
    `SELECT puuid FROM ranked_players WHERE tier = ANY($1::text[]) ORDER BY tier, rank, puuid`,
    [tiers],
  );
  return r.rows.map((x) => x.puuid);
}

/** 주어진 ID 중 이미 matches에 있는 ID */
export async function existingMatchIds(db: Queryable, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const r = await db.query<{ match_id: string }>(`SELECT match_id FROM matches WHERE match_id = ANY($1::text[])`, [
    ids,
  ]);
  return new Set(r.rows.map((x) => x.match_id));
}

/** matches에 있는 패치별 게임 수 */
export async function matchCountsByPatch(db: Queryable): Promise<Map<string, number>> {
  const r = await db.query<{ patch: string; n: number }>(
    `SELECT patch, count(*)::int AS n FROM matches GROUP BY patch ORDER BY patch_sort_key(patch)`,
  );
  return new Map(r.rows.map((x) => [x.patch, x.n]));
}

/** matches 1줄. 이미 있으면 0 (ON CONFLICT DO NOTHING) */
export async function insertMatch(db: Queryable, m: MatchRow): Promise<number> {
  const r = await db.query(
    `INSERT INTO matches (match_id, puuid, patch) VALUES ($1, $2, $3) ON CONFLICT (match_id) DO NOTHING`,
    [m.match_id, m.puuid, m.patch],
  );
  return r.rowCount ?? 0;
}

const PLAYER_COLUMNS = [
  'match_id', 'puuid', 'champion_id', 'team_position', 'win', 'ban_champion_id',
  'summoner1_id', 'summoner2_id',
  'primary_style', 'primary_perk1', 'primary_perk2', 'primary_perk3', 'primary_perk4',
  'sub_style', 'sub_perk1', 'sub_perk2',
  'stat_offense', 'stat_flex', 'stat_defense',
  'item0', 'item1', 'item2', 'item3', 'item4', 'item5',
  'skill_order',
] as const satisfies readonly (keyof PlayerRow)[];

/** match_players 여러 줄을 한 문장으로 */
export async function insertMatchPlayers(db: Queryable, rows: PlayerRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const values: unknown[] = [];
  const tuples = rows.map((row, r) => {
    const ph = PLAYER_COLUMNS.map((col, c) => {
      values.push(row[col]);
      return `$${r * PLAYER_COLUMNS.length + c + 1}`;
    });
    return `(${ph.join(', ')})`;
  });
  const res = await db.query(
    `INSERT INTO match_players (${PLAYER_COLUMNS.join(', ')}) VALUES ${tuples.join(', ')}`,
    values,
  );
  return res.rowCount ?? 0;
}

/** 게임 1개 저장 (호출하는 쪽이 트랜잭션을 연다). 이미 있으면 'duplicate' */
export async function saveMatch(db: Queryable, m: MatchRow, players: PlayerRow[]): Promise<'saved' | 'duplicate'> {
  const n = await insertMatch(db, m);
  if (n === 0) return 'duplicate';
  await insertMatchPlayers(db, players);
  return 'saved';
}

export async function distinctMatchPatches(db: Queryable): Promise<string[]> {
  const r = await db.query<{ patch: string }>(
    `SELECT DISTINCT patch FROM matches ORDER BY patch_sort_key(patch)`,
  );
  return r.rows.map((x) => x.patch);
}
