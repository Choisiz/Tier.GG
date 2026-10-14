// window 객체 (api_contract v2 2-0, back_spec 변경 01-6-2·01-6-3·01-6-5)
import { STALE_AFTER_HOURS } from '../config/api.js';
import { createLogger, type Logger } from '../lib/logger.js';
import type { WindowRow } from '../repositories/statsRepository.js';
import { ApiError } from './errors.js';

const PATCH_RE = /^([0-9]+)\.([0-9]+)$/;
const STALE_AFTER_MS = STALE_AFTER_HOURS * 3_600_000;

const defaultLogger = createLogger('api');

/** 공개 패치 이름 = 메이저 + 10 ('16.20' → '26.20', '16.9' → '26.9'). 형식이 다르면 내부 값 그대로 + 경고 */
export function displayPatch(patch: string, logger: Logger = defaultLogger): string {
  const m = PATCH_RE.exec(patch);
  if (!m) {
    logger.warn('패치 형식이 아니라 displayName에 내부 값을 그대로 씀', { patch });
    return patch;
  }
  return `${Number(m[1]) + 10}.${Number(m[2])}`;
}

/** 100 × part / total, 소수 2자리 (결정 D17) */
export function sharePercent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((10_000 * part) / total) / 100;
}

/** 지금 − aggregatedAt > 26시간. 정확히 26시간은 false */
export function isStale(aggregatedAt: Date, nowMs: number): boolean {
  return nowMs - aggregatedAt.getTime() > STALE_AFTER_MS;
}

export type StatsState = 'fresh' | 'stale' | 'empty';

export function statsState(aggregatedAt: Date | null, nowMs: number): StatsState {
  if (aggregatedAt === null) return 'empty';
  return isStale(aggregatedAt, nowMs) ? 'stale' : 'fresh';
}

export function windowDto(row: WindowRow, nowMs: number, logger: Logger = defaultLogger) {
  return {
    days: row.days,
    start: row.windowStart.toISOString(),
    end: row.windowEnd.toISOString(),
    games: row.games,
    aggregatedAt: row.aggregatedAt.toISOString(),
    isStale: isStale(row.aggregatedAt, nowMs),
    patches: row.patches.map((p) => ({
      patch: p.patch,
      displayName: displayPatch(p.patch, logger),
      games: p.games,
      share: sharePercent(p.games, row.games),
    })),
  };
}

export type WindowDto = ReturnType<typeof windowDto>;

/** 집계 전(stats_window 0줄)이면 503 STATS_NOT_READY */
export function requireWindow(row: WindowRow | null): WindowRow {
  if (row) return row;
  throw new ApiError(503, 'STATS_NOT_READY', '아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다.');
}

/** isStale을 보면 1시간에 1번만 경고 로그 (back_spec 변경 01-6-3) */
export function createStaleWarner(logger: Logger, intervalMs = 3_600_000): (aggregatedAt: Date, nowMs: number) => void {
  let last = Number.NEGATIVE_INFINITY;
  return (aggregatedAt, nowMs) => {
    if (!isStale(aggregatedAt, nowMs) || nowMs - last < intervalMs) return;
    last = nowMs;
    logger.warn(`집계가 ${STALE_AFTER_HOURS}시간 넘게 갱신되지 않음`, { aggregatedAt: aggregatedAt.toISOString() });
  };
}
