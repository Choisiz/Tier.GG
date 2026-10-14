// aggregate(시험용): ANALYZE + refresh_window_stats, purge 미리보기 (back_spec 변경 01-4-5, 계약 9-4)
// 평소 집계는 매일 05:00 KST DB 예약 작업(tiergg_daily_refresh)이 같은 순서로 한다. 수집은 집계를 부르지 않는다.
import pg from 'pg';
import type { Queryable } from '../db/tx.js';
import type { Logger } from '../lib/logger.js';
import { purgePreview, type PurgePreview } from '../repositories/rawRepository.js';

export interface WindowAggregate {
  ok: boolean;
  analyzeMs: number;
  refreshMs: number;
  /** refresh_window_stats 반환 jsonb {window_start, window_end, days, games, patches, *_rows} */
  result?: Record<string, unknown>;
  warning?: string;
}

export interface AggregateWindowOptions {
  days: number;
  /** p_until. **통합 테스트 전용** (CLI에는 없음). 없으면 함수 기본값 now() */
  until?: string | Date;
  statementTimeout?: string;
}

/**
 * 계약 9-4: 같은 연결에서 SET statement_timeout → ANALYZE matches, match_players → SELECT refresh_window_stats(days[, until]) → RESET.
 * 창 안 완료 게임 0개(P0002)는 { ok: false, warning } (기존 집계 유지).
 */
export async function aggregateWindow(db: Queryable, opts: AggregateWindowOptions, logger: Logger): Promise<WindowAggregate> {
  const timeout = (opts.statementTimeout ?? '5min').replace(/[^0-9a-z]/gi, '');
  await db.query(`SET statement_timeout = '${timeout}'`);
  try {
    const t0 = Date.now();
    await db.query('ANALYZE matches, match_players');
    const analyzeMs = Date.now() - t0;
    logger.info('ANALYZE 끝', { ms: analyzeMs });
    const t1 = Date.now();
    try {
      const r =
        opts.until === undefined
          ? await db.query<{ r: Record<string, unknown> }>('SELECT refresh_window_stats($1) AS r', [opts.days])
          : await db.query<{ r: Record<string, unknown> }>('SELECT refresh_window_stats($1, $2::timestamptz) AS r', [
              opts.days,
              opts.until,
            ]);
      const refreshMs = Date.now() - t1;
      const result = r.rows[0]?.r ?? {};
      logger.info('집계 끝', { ms: refreshMs, result: JSON.stringify(result) });
      return { ok: true, analyzeMs, refreshMs, result };
    } catch (err) {
      if (err instanceof pg.DatabaseError && err.code === 'P0002') {
        const warning = '창 안 완료 게임 0개, 기존 집계 유지';
        logger.warn(`집계 건너뜀: ${warning}`);
        return { ok: false, analyzeMs, refreshMs: Date.now() - t1, warning };
      }
      throw err;
    }
  } finally {
    await db.query('RESET statement_timeout').catch(() => undefined);
  }
}

/** 연결 1개를 빌려 aggregateWindow (ANALYZE와 집계가 같은 연결이어야 함) */
export async function aggregateWindowOnPool(
  pool: pg.Pool,
  opts: AggregateWindowOptions,
  logger: Logger,
): Promise<WindowAggregate> {
  const client = await pool.connect();
  try {
    return await aggregateWindow(client, opts, logger);
  } finally {
    client.release();
  }
}

/** purge 미리보기 (읽기만): 전체 게임 수, keepDays보다 오래된 게임 수, 가장 오래된·최근 시작 시각 */
export function planPurgeGames(db: Queryable, keepDays: number): Promise<PurgePreview> {
  return purgePreview(db, keepDays);
}
