// 표시 패치 결정 (api_contract 2-0, 결정 D3)
import { FALLBACK_MIN_GAMES } from '../config/api.js';
import type { PatchRow } from '../repositories/statsRepository.js';
import { ApiError } from './errors.js';

export interface PatchInfo {
  data: string;
  latest: string;
  requested: string | null;
  isFallback: boolean;
  games: number;
}

/**
 * patches: 집계된 패치, 최신 순 (patch_sort_key DESC)
 * - 하나도 없으면 503 STATS_NOT_READY
 * - requested가 있으면 그대로 (대체 없음), 없으면 404 PATCH_NOT_FOUND
 * - 없으면: 최신 games < minGames 이고 직전 패치가 있고 직전이 더 많으면 직전 패치
 */
export function selectPatch(
  patches: PatchRow[],
  requested: string | null,
  minGames: number = FALLBACK_MIN_GAMES,
): PatchInfo {
  const latest = patches[0];
  if (!latest) throw new ApiError(503, 'STATS_NOT_READY', '아직 집계된 패치가 없습니다.');
  if (requested !== null) {
    const p = patches.find((x) => x.patch === requested);
    if (!p) throw new ApiError(404, 'PATCH_NOT_FOUND', `패치 ${requested}의 집계가 없습니다.`, { patch: requested });
    return { data: p.patch, latest: latest.patch, requested, isFallback: false, games: p.games };
  }
  const prev = patches[1];
  if (latest.games < minGames && prev && prev.games > latest.games) {
    return { data: prev.patch, latest: latest.patch, requested: null, isFallback: true, games: prev.games };
  }
  return { data: latest.patch, latest: latest.patch, requested: null, isFallback: false, games: latest.games };
}
