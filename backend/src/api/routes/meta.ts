// GET /api/v1/health, GET /api/v1/meta (api_contract 2-1, 2-2)
import { Router } from 'express';
import {
  FALLBACK_MIN_GAMES,
  MIN_TIER_PICK,
  POSITIONS,
  SECONDARY_POSITION_MIN_SHARE,
} from '../../config/api.js';
import type { Queryable } from '../../db/tx.js';
import { lastDoneAt } from '../../repositories/logRepository.js';
import { listPatches, ping } from '../../repositories/statsRepository.js';
import { ApiError } from '../errors.js';
import { selectPatch } from '../patchSelection.js';
import { cacheOk } from '../cache.js';

export function metaRouter(db: Queryable): Router {
  const r = Router();

  r.get('/health', async (_req, res) => {
    try {
      await ping(db);
    } catch {
      throw new ApiError(503, 'DB_UNAVAILABLE', '데이터베이스에 연결할 수 없습니다.');
    }
    res.set('Cache-Control', 'no-store').json({ status: 'ok', db: 'ok' });
  });

  r.get('/meta', async (_req, res) => {
    const [patches, last] = await Promise.all([listPatches(db), lastDoneAt(db)]);
    const sel = selectPatch(patches, null);
    cacheOk(res).json({
      latestPatch: sel.latest,
      defaultPatch: sel.data,
      isFallback: sel.isFallback,
      patches: patches.map((p) => ({ patch: p.patch, games: p.games })),
      lastCollectedAt: last ? last.toISOString() : null,
      positions: [...POSITIONS],
      rules: {
        minTierPick: MIN_TIER_PICK,
        secondaryPositionMinShare: SECONDARY_POSITION_MIN_SHARE,
        fallbackMinGames: FALLBACK_MIN_GAMES,
      },
    });
  });

  return r;
}
