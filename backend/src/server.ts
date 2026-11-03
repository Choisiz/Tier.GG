// 진입점 1: API 서버 (조회 GET + 분석 POST 1개, 변경 05). collector/*는 부르지 않는다.
// 변경 03부터 전적 검색(소환사 상세)을 위해 RIOT_API_KEY를 읽는다 (back_spec 변경 03 W-1-4, back_overview 2장 갱신 필요).
// npm run dev (watch) / npm start
import { createApp, type ApiDb } from './api/app.js';
import type { SummonerSearchDto } from './api/dto.js';
import type { SummonerSearchFn } from './api/summonerSearch.js';
import { createLaneGold, type LaneGoldFn } from './api/laneGold.js';
import { createMatchLaneCache } from './api/matchLaneCache.js';
import { createSummonerCache } from './api/summonerCache.js';
import { createSummonerSearch } from './api/summonerSearch.js';
import { ApiError } from './api/errors.js';
import { RIOT_CLIENT_CONFIG } from './config/collection.js';
import { EnvError, loadApiPort, loadDbEnv, loadFeedbackEnv, loadRiotEnv } from './config/env.js';
import { API_RIOT_RATE_LIMIT, MATCH_LANE_CACHE_MAX, MATCH_LANE_CACHE_TTL_MS, SUMMONER_CACHE_MAX, SUMMONER_CACHE_TTL_MS } from './config/summoner.js';
import { createPool } from './db/pool.js';
import { readSnapshot } from './db/snapshot.js';
import { createLogger, formatError } from './lib/logger.js';
import { RiotClient } from './riot/client.js';
import { RateLimiter } from './riot/rateLimiter.js';
import { createAnthropicClient } from './analysis/llm/client.js';
import { fileLedger } from './analysis/llm/ledger.js';
import { priceOf } from './analysis/llm/pricing.js';
import { createChampionData, loadSnapshot } from './api/feedback/championData.js';
import { createBreaker, createBudgetGuard, createDailyLimit, createSemaphore, countTodayFromLedger } from './api/feedback/limits.js';
import { createFeedbackService, unavailableFeedback, type FeedbackFn } from './api/feedback/service.js';
import {
  DDRAGON_BASE_URL,
  DDRAGON_CACHE_VERSIONS,
  DDRAGON_SNAPSHOT_PATH,
  DDRAGON_TIMEOUT_MS,
  DDRAGON_VERSIONS_TTL_MS,
  DDRAGON_WARN_INTERVAL_MS,
  FEEDBACK_BREAKER_MS,
  FEEDBACK_CONCURRENCY,
  FEEDBACK_LEDGER_PATH,
  FEEDBACK_LLM_MAX_RETRIES,
  FEEDBACK_LLM_TIMEOUT_MS,
  FEEDBACK_QUEUE_MAX,
} from './config/feedback.js';

const logger = createLogger('server');

/**
 * RIOT_API_KEY가 없거나 형식이 잘못돼도 서버는 계속 켜진다(소환사 검색만 못 쓴다).
 * 개발 키가 24시간마다 만료되므로, 키 문제로 챔피언 통계 엔드포인트까지 막히면 안 된다.
 */
function buildRiotServices(): { summonerSearch: SummonerSearchFn; laneGold: LaneGoldFn; riot: RiotClient | null } {
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
    const laneCache = createMatchLaneCache(MATCH_LANE_CACHE_TTL_MS, MATCH_LANE_CACHE_MAX);
    return {
      summonerSearch: createSummonerSearch({ riot, cache, laneCache, logger: createLogger('summoner-search') }),
      laneGold: createLaneGold({ riot, cache: laneCache, logger: createLogger('lane-gold') }),
      riot,
    };
  } catch (err) {
    logger.warn('RIOT_API_KEY가 없어 전적 검색을 쓸 수 없습니다 (챔피언 통계 API는 그대로 동작)', { error: formatError(err) });
    const keyMissing = async (): Promise<never> => {
      throw new ApiError(503, 'RIOT_KEY_EXPIRED', 'Riot API 키가 설정되지 않아 조회할 수 없습니다.');
    };
    return { summonerSearch: keyMissing, laneGold: keyMissing, riot: null };
  }
}

/**
 * 게임 피드백 분석 조립 (back_spec 변경 05, 05-6). 무거운 것(LLM 클라이언트·장부·캐시)은 시작 때 1번 만든다.
 * 기본(.env에 새 변수 없음)은 꺼짐 → 503 ANALYSIS_DISABLED, LLM 클라이언트를 만들지 않는다. 키 값은 로그에 남기지 않는다.
 */
function buildFeedback(riot: RiotClient | null): FeedbackFn {
  const fbLogger = createLogger('feedback');
  const env = loadFeedbackEnv();
  for (const p of env.problems) fbLogger.warn(`피드백 API 설정 오류로 기능을 끕니다: ${p}`);
  if (!env.enabled) {
    fbLogger.info('피드백 API enabled=false (FEEDBACK_ENABLED가 true가 아님) → 503 ANALYSIS_DISABLED');
    return unavailableFeedback(new ApiError(503, 'ANALYSIS_DISABLED', '게임 분석 기능이 꺼져 있습니다.'));
  }
  if (!riot) {
    return unavailableFeedback(new ApiError(503, 'RIOT_KEY_EXPIRED', 'Riot API 키가 설정되지 않아 조회할 수 없습니다.'));
  }

  // LLM: 스위치 + 키 + 가격표에 있는 모델 + 하루 상한 > 0 일 때만 클라이언트를 만든다
  let llmOff: string | null = null;
  if (!env.llmEnabled) llmOff = 'FEEDBACK_LLM_ENABLED=false';
  else if (!env.apiKey) llmOff = 'ANTHROPIC_API_KEY 없음';
  else if (env.dailyLimit <= 0) llmOff = 'FEEDBACK_DAILY_LIMIT=0';
  else {
    try {
      priceOf(env.model);
    } catch {
      llmOff = '가격표에 없는 모델';
      fbLogger.error('FEEDBACK_LLM_MODEL이 가격표에 없어 LLM을 끕니다 (pricing.ts 확인)', { model: env.model });
    }
  }
  const client =
    llmOff === null && env.apiKey
      ? createAnthropicClient({ apiKey: env.apiKey, timeoutMs: FEEDBACK_LLM_TIMEOUT_MS, maxRetries: FEEDBACK_LLM_MAX_RETRIES })
      : null;

  const ledger = fileLedger(FEEDBACK_LEDGER_PATH);
  const startMs = Date.now();
  // 장부를 못 읽으면(깨진 줄 등) 하루 수·예산을 알 수 없다 → 서버 전체를 멈추지 않고 분석만 끈다 (Review 2026-11-03 L1)
  let restoredToday: number;
  try {
    restoredToday = countTodayFromLedger(ledger.entries(), startMs);
  } catch (err) {
    fbLogger.error('API 사용량 장부를 읽을 수 없어 분석 기능을 끕니다 (장부 파일 확인)', { error: formatError(err) });
    return unavailableFeedback(new ApiError(503, 'ANALYSIS_DISABLED', '게임 분석 기능이 꺼져 있습니다.'));
  }
  const daily = createDailyLimit(env.dailyLimit, restoredToday, startMs);
  const budget = createBudgetGuard(env.budgetUsd, () => ledger.totalUsd());
  const champData = createChampionData({
    baseUrl: DDRAGON_BASE_URL,
    timeoutMs: DDRAGON_TIMEOUT_MS,
    maxVersions: DDRAGON_CACHE_VERSIONS,
    versionsTtlMs: DDRAGON_VERSIONS_TTL_MS,
    warnIntervalMs: DDRAGON_WARN_INTERVAL_MS,
    snapshot: loadSnapshot(DDRAGON_SNAPSHOT_PATH),
    logger: fbLogger,
  });
  fbLogger.info(
    `피드백 API enabled=true llm=${client ? 'on' : `off(${llmOff})`} model=${env.model} effort=${env.effort} dailyLimit=${env.dailyLimit} budget=$${env.budgetUsd.toFixed(2)} spent=$${budget.spentUsd().toFixed(4)} today=${daily.used(startMs)}/${env.dailyLimit} key=${env.apiKey ? '있음' : '없음'}`,
  );
  return createFeedbackService({
    riot,
    llm: { client, model: env.model, effort: env.effort },
    ledger,
    champData,
    daily,
    budget,
    semaphore: createSemaphore(FEEDBACK_CONCURRENCY, FEEDBACK_QUEUE_MAX),
    breaker: createBreaker(FEEDBACK_BREAKER_MS),
    logger: fbLogger,
  });
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
  const { summonerSearch, laneGold, riot } = buildRiotServices();
  const feedback = buildFeedback(riot);
  // logger는 생략해 createApp 기본값([api] 태그)을 그대로 쓴다 (기존 동작 유지)
  const app = createApp(db, undefined, { summonerSearch, laneGold, feedback });
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
