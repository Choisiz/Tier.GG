// ⑥ ANALYZE + refresh_patch_stats, ⑦ purge (back_spec 3-2 ⑥, 3-7, 계약 9-4)
import pg from 'pg';
import type { Queryable } from '../db/tx.js';
import type { Logger } from '../lib/logger.js';
import { matchCountsByPatch } from '../repositories/rawRepository.js';
import { listPatches } from '../repositories/statsRepository.js';
import { comparePatch, latestPatches } from './transform.js';

export interface PatchAggregate {
  patch: string;
  ok: boolean;
  result?: Record<string, unknown>;
  warning?: string;
  ms: number;
}

export interface AggregateResult {
  analyzeMs: number;
  patches: PatchAggregate[];
}

/**
 * 계약 9-4: 같은 연결에서 ANALYZE matches, match_players → 패치마다 refresh_patch_stats (패치 순서대로).
 * 게임 수와 관계없이 항상 ANALYZE를 먼저 한다.
 * 완료 게임 0개 오류(P0002)는 그 패치만 경고로 남기고 기존 집계를 둔다.
 */
export async function aggregateOnConnection(
  db: Queryable,
  patches: string[],
  logger: Logger,
  statementTimeout = '5min',
): Promise<AggregateResult> {
  const ordered = [...new Set(patches)].sort(comparePatch);
  await db.query(`SET statement_timeout = '${statementTimeout.replace(/[^0-9a-z]/gi, '')}'`);
  try {
    const t0 = Date.now();
    await db.query('ANALYZE matches, match_players');
    const analyzeMs = Date.now() - t0;
    logger.info('⑥ ANALYZE 끝', { ms: analyzeMs });
    const out: AggregateResult = { analyzeMs, patches: [] };
    for (const patch of ordered) {
      const t1 = Date.now();
      try {
        const r = await db.query<{ r: Record<string, unknown> }>('SELECT refresh_patch_stats($1) AS r', [patch]);
        const result = r.rows[0]?.r ?? {};
        const ms = Date.now() - t1;
        out.patches.push({ patch, ok: true, result, ms });
        logger.info('⑥ 집계 끝', { patch, ms, result });
      } catch (err) {
        if (err instanceof pg.DatabaseError && err.code === 'P0002') {
          const ms = Date.now() - t1;
          out.patches.push({ patch, ok: false, warning: '완료 게임 0개, 기존 집계 유지', ms });
          logger.warn('⑥ 집계 건너뜀: 완료 게임 0개, 기존 집계 유지', { patch });
          continue;
        }
        throw err;
      }
    }
    return out;
  } finally {
    await db.query('RESET statement_timeout').catch(() => undefined);
  }
}

export async function aggregatePatches(
  pool: pg.Pool,
  patches: string[],
  logger: Logger,
  statementTimeout?: string,
): Promise<AggregateResult> {
  const client = await pool.connect();
  try {
    return await aggregateOnConnection(client, patches, logger, statementTimeout);
  } finally {
    client.release();
  }
}

export interface PurgePlan {
  perPatch: { patch: string; games: number }[];
  keep: string[];
  remove: { patch: string; games: number }[];
  notAggregated: string[];
}

/** 지울 패치·게임 수 계산 (읽기만) */
export async function planPurge(db: Queryable, keepPatches: number): Promise<PurgePlan> {
  const counts = await matchCountsByPatch(db);
  const perPatch = [...counts.entries()]
    .map(([patch, games]) => ({ patch, games }))
    .sort((a, b) => comparePatch(b.patch, a.patch));
  const keep = latestPatches(counts.keys(), keepPatches);
  const remove = perPatch.filter((p) => !keep.includes(p.patch));
  const aggregated = new Set((await listPatches(db)).map((p) => p.patch));
  const notAggregated = remove.filter((p) => !aggregated.has(p.patch)).map((p) => p.patch);
  return { perPatch, keep, remove, notAggregated };
}
