// 진입점 1: API 서버 (읽기 전용). collector/*는 부르지 않는다.
// 변경 03부터 전적 검색(소환사 상세)을 위해 RIOT_API_KEY를 읽는다 (back_spec 변경 03 W-1-4, back_overview 2장 갱신 필요).
// npm run dev (watch) / npm start
import { createApp, type ApiDb } from './api/app.js';
import type { SummonerSearchDto } from './api/dto.js';
import type { SummonerSearchFn } from './api/summonerSearch.js';
import { createSummonerCache } from './api/summonerCache.js';
import { createSummonerSearch } from './api/summonerSearch.js';
import { ApiError } from './api/errors.js';
import { RIOT_CLIENT_CONFIG } from './config/collection.js';
import { EnvError, loadApiPort, loadDbEnv, loadRiotEnv } from './config/env.js';
import { API_RIOT_RATE_LIMIT, SUMMONER_CACHE_MAX, SUMMONER_CACHE_TTL_MS } from './config/summoner.js';
import { createPool } from './db/pool.js';
import { readSnapshot } from './db/snapshot.js';
import { createLogger, formatError } from './lib/logger.js';
import { RiotClient } from './riot/client.js';
import { RateLimiter } from './riot/rateLimiter.js';

const logger = createLogger('server');

/**
 * RIOT_API_KEY가 없거나 형식이 잘못돼도 서버는 계속 켜진다(소환사 검색만 못 쓴다).
 * 개발 키가 24시간마다 만료되므로, 키 문제로 챔피언 통계 엔드포인트까지 막히면 안 된다.
 */
function buildSummonerSearch(): SummonerSearchFn {
  try {
    const { apiKey, platformUrl, regionUrl } = loadRiotEnv();
    const limiter = new RateLimiter({
      perSecond: API_RIOT_RATE_LIMIT.perSecondLimit,
      perWindow: API_RIOT_RATE_LIMIT.perWindowLimit,
      windowMs: API_RIOT_RATE_LIMIT.windowMs,
    });
    const riotLogger = createLogger('riot-api');
    const riot = new RiotClient({ apiKey, platformUrl, regionUrl, limiter, config: RIOT_CLIENT_CONFIG, logger: riotLogger });
    const cache = createSummonerCache<SummonerSearchDto>(SUMMONER_CACHE_TTL_MS, SUMMONER_CACHE_MAX);
    return createSummonerSearch({ riot, cache, logger: createLogger('summoner-search') });
  } catch (err) {
    logger.warn('RIOT_API_KEY가 없어 전적 검색을 쓸 수 없습니다 (챔피언 통계 API는 그대로 동작)', { error: formatError(err) });
    return async () => {
      throw new ApiError(503, 'RIOT_KEY_EXPIRED', 'Riot API 키가 설정되지 않아 조회할 수 없습니다.');
    };
  }
}

function main(): void {
  const { databaseUrl } = loadDbEnv();
  const port = loadApiPort();
  const pool = createPool(databaseUrl, 5, logger);
  // health는 풀에 바로, 통계 엔드포인트는 요청마다 스냅숏 트랜잭션 1개 (변경 01-6-4)
  const db: ApiDb = {
    query: (text, values) => pool.query(text, values),
    snapshot: (fn) => readSnapshot(pool, fn, logger),
  };
  const summonerSearch = buildSummonerSearch();
  // logger는 생략해 createApp 기본값([api] 태그)을 그대로 쓴다 (기존 동작 유지)
  const app = createApp(db, undefined, { summonerSearch });
  const server = app.listen(port, () => logger.info('API 서버 시작', { url: `http://localhost:${port}/api/v1` }));
  server.on('error', (err) => {
    logger.error('서버 시작 실패', { error: formatError(err) });
    process.exitCode = 1;
  });

  const shutdown = (signal: string) => {
    logger.info('종료 중', { signal });
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (err) {
  logger.error(err instanceof EnvError ? err.message : formatError(err));
  process.exitCode = 1;
}
