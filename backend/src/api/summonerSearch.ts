// 전적 검색 호출 순서·캐시·오류 매핑 (back_spec 변경 03 W-2, W-3, W-5). 라우트에서 분리해 단위 테스트하기 쉽게 한다.
// account-v1 → summoner-v4 + league-v4(병렬) → match-v5 ids → match-v5 상세 × 최대 20(병렬, 일부 실패는 건너뜀).
import type { Logger } from '../lib/logger.js';
import type { RiotClient } from '../riot/client.js';
import { RiotKeyExpiredError, RiotNotFoundError, RiotRetryExhaustedError } from '../riot/errors.js';
import type { MatchDto } from '../riot/types.js';
import type { SummonerCache } from './summonerCache.js';
import { summonerSearchDto, type SummonerSearchDto } from './dto.js';
import { ApiError } from './errors.js';
import { RECENT_MATCH_COUNT } from '../config/summoner.js';

export type SummonerSearchFn = (region: string, gameName: string, tagLine: string) => Promise<SummonerSearchDto>;

export interface SummonerSearchDeps {
  riot: RiotClient;
  cache: SummonerCache<SummonerSearchDto>;
  logger: Logger;
  /** 지금 시각(ms). 캐시 키 만료 판단용, 테스트에서 고정 */
  now?: () => number;
}

function cacheKey(region: string, gameName: string, tagLine: string): string {
  return `${region}:${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
}

export function createSummonerSearch({ riot, cache, logger, now = Date.now }: SummonerSearchDeps): SummonerSearchFn {
  return async function summonerSearch(region, gameName, tagLine) {
    const key = cacheKey(region, gameName, tagLine);
    const hit = cache.get(key, now());
    if (hit) {
      logger.info('소환사 검색 캐시 적중', { region });
      return hit;
    }

    try {
      const account = await riot.getAccountByRiotId(gameName, tagLine);
      const [summoner, leagues] = await Promise.all([
        riot.getSummonerByPuuid(account.puuid),
        riot.getLeagueEntriesByPuuid(account.puuid),
      ]);
      const matchIds = await riot.getRecentMatchIds(account.puuid, { start: 0, count: RECENT_MATCH_COUNT });
      const settled = await Promise.all(matchIds.map((id) => riot.getMatch(id).then(
        (m): { ok: true; match: MatchDto } => ({ ok: true, match: m }),
        (err: unknown): { ok: false; err: unknown } => ({ ok: false, err }),
      )));
      const matches = settled.filter((r): r is { ok: true; match: MatchDto } => r.ok).map((r) => r.match);
      const skipped = settled.length - matches.length;
      if (skipped > 0) {
        logger.warn('매치 상세 일부 실패, 나머지로 응답', { region, skipped, total: matchIds.length });
      }

      const dto = summonerSearchDto(account, summoner, leagues, matches);
      cache.set(key, dto, now());
      logger.info('소환사 검색 캐시 미스', { region, matches: matches.length, skipped });
      return dto;
    } catch (err) {
      if (err instanceof RiotNotFoundError) {
        throw new ApiError(404, 'SUMMONER_NOT_FOUND', '해당 소환사를 찾을 수 없습니다.', { region, gameName, tagLine });
      }
      if (err instanceof RiotKeyExpiredError) {
        // 매 요청마다 로그(제한 없음, 결정 S5). 이 요청만 실패하고 서버는 멈추지 않는다.
        logger.error('Riot 키 만료로 소환사 검색 실패', { region });
        throw new ApiError(503, 'RIOT_KEY_EXPIRED', 'Riot API 키가 만료되어 조회할 수 없습니다.');
      }
      if (err instanceof RiotRetryExhaustedError) {
        throw new ApiError(502, 'RIOT_UNAVAILABLE', 'Riot API를 일시적으로 사용할 수 없습니다.');
      }
      // 그 밖(예상 못한 오류, RiotBadRequestError 포함)은 그대로 올려 오류 미들웨어가 500으로 처리한다.
      throw err;
    }
  };
}
