// GET /api/v1/health, GET /api/v1/meta (api_contract v2 2-1, 2-2)
import { Router } from 'express';
import {
  MIN_TIER_PICK,
  POSITIONS,
  SECONDARY_POSITION_MIN_SHARE,
  STALE_AFTER_HOURS,
  WINDOW_DAYS,
} from '../../config/api.js';
import { lastDoneAt } from '../../repositories/logRepository.js';
import { readAggregatedAt, readWindow } from '../../repositories/statsRepository.js';
import type { ApiDeps } from '../app.js';
import { cacheOk } from '../cache.js';
import { ApiError } from '../errors.js';
import { requireWindow, statsState, windowDto } from '../window.js';

export function metaRouter({ db, logger, now, warnIfStale }: ApiDeps): Router {
  const r = Router();

  // 한 문장이 DB 확인(SELECT 1 대신)과 집계 상태를 함께 한다. 집계가 오래돼도 HTTP는 항상 200
  r.get('/health', async (_req, res) => {
    let aggregatedAt: Date | null;
    try {
      aggregatedAt = await readAggregatedAt(db);
    } catch {
      throw new ApiError(503, 'DB_UNAVAILABLE', '데이터베이스에 연결할 수 없습니다.');
    }
    res.set('Cache-Control', 'no-store').json({
      status: 'ok',
      db: 'ok',
      stats: { state: statsState(aggregatedAt, now()), aggregatedAt: aggregatedAt ? aggregatedAt.toISOString() : null },
    });
  });

  r.get('/meta', async (_req, res) => {
    const { win, last } = await db.snapshot(async (q) => {
      const win = requireWindow(await readWindow(q)); // 첫 문장 = 스냅숏 기준
      const last = await lastDoneAt(q);
      return { win, last };
    });
    const t = now();
    warnIfStale(win.aggregatedAt, t);
    cacheOk(res).json({
      window: windowDto(win, t, logger),
      lastCollectedAt: last ? last.toISOString() : null,
      positions: [...POSITIONS],
      rules: {
        minTierPick: MIN_TIER_PICK,
        secondaryPositionMinShare: SECONDARY_POSITION_MIN_SHARE,
        windowDays: WINDOW_DAYS,
        staleAfterHours: STALE_AFTER_HOURS,
      },
    });
  });

  return r;
}
