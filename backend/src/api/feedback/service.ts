// 게임 피드백 분석 서비스 (back_spec 변경 05, 05-4·05-7·05-8).
// 싼 검사부터 하고 비싼 일(timeline, LLM)은 마지막에. 결과는 서버 메모리에 캐시하고, 같은 키의 동시 요청은 Promise를 공유한다.
// !ai 코드(analysis/**)는 import만 한다. LLM 문제는 오류가 아니라 200 + 템플릿 문장이다(하루 상한·예산만 429).
import { createFeedbackFromResult, type FeedbackResult } from '../../analysis/feedback.js';
import { AnalysisError, analyzeMatch, ENGINE_VERSION } from '../../analysis/index.js';
import type { LlmClient, LlmEffort } from '../../analysis/llm/client.js';
import { buildFacts } from '../../analysis/llm/facts.js';
import { MAX_TOKENS } from '../../analysis/llm/generate.js';
import { calibration, type Ledger } from '../../analysis/llm/ledger.js';
import { estimateTokens, worstCallCost } from '../../analysis/llm/pricing.js';
import { buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from '../../analysis/llm/prompt.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline } from '../../analysis/types.js';
import {
  FEEDBACK_BUSY_RETRY_MAX_SEC,
  FEEDBACK_CACHE_MAX,
  FEEDBACK_CACHE_TTL_MS,
  FEEDBACK_DEADLINE_MS,
  FEEDBACK_DEFAULT_INPUT_FACTOR,
  FEEDBACK_KNOWLEDGE_VERSION,
  FEEDBACK_RETRY_AFTER_SEC,
  FEEDBACK_RETRY_MSG_TOKENS,
  FEEDBACK_RIOT_MAX_WAIT_MS,
  FEEDBACK_TEMPLATE_CACHE_MAX,
  FEEDBACK_TEMPLATE_CACHE_TTL_MS,
} from '../../config/feedback.js';
import { formatError, shortPuuid, type Logger } from '../../lib/logger.js';
import type { RiotClient } from '../../riot/client.js';
import { RiotKeyExpiredError, RiotNotFoundError, RiotRetryExhaustedError } from '../../riot/errors.js';
import type { MatchDto, TimelineDto } from '../../riot/types.js';
import { ApiError } from '../errors.js';
import { createSummonerCache, type SummonerCache } from '../summonerCache.js';
import type { ChampionData, ChampionDataProvider } from './championData.js';
import { toFeedbackDto, type FeedbackDto, type TemplateReason } from './dto.js';
import type { Breaker, BudgetGuard, DailyLimit, Semaphore } from './limits.js';
import { precheckMatch } from './precheck.js';

/** 라우트가 부르는 함수. unavailable이 있으면 라우트가 입력 검사 전에 그 오류로 응답한다 (05-4 ① 스위치) */
export type FeedbackFn = {
  (matchId: string, puuid: string): Promise<FeedbackDto>;
  unavailable?: ApiError;
};

/** 항상 같은 오류를 내는 함수 (꺼짐 503, Riot 키 없음 503, 미설정 500) */
export function unavailableFeedback(err: ApiError): FeedbackFn {
  const fn: FeedbackFn = async () => {
    throw err;
  };
  fn.unavailable = err;
  return fn;
}

export type FeedbackRiot = Pick<RiotClient, 'getMatch' | 'getTimeline' | 'limiterWaitMs'>;

export interface FeedbackLlmConfig {
  /** null = LLM 끔(설정 끔·키 없음·가격표에 없는 모델) → 0원 템플릿 llm_off */
  client: LlmClient | null;
  model: string;
  effort: LlmEffort;
}

export interface FeedbackServiceDeps {
  riot: FeedbackRiot;
  llm: FeedbackLlmConfig;
  ledger: Ledger;
  champData: ChampionDataProvider;
  daily: DailyLimit;
  budget: BudgetGuard;
  semaphore: Semaphore;
  breaker: Breaker;
  logger: Logger;
  now?: () => number;
  deadlineMs?: number;
  resultCache?: SummonerCache<FeedbackDto>;
  templateCache?: SummonerCache<FeedbackDto>;
}

/** 분석 1건 로그용 */
interface RunStats {
  riotCalls: number;
  feedback: FeedbackResult | null;
  championDataVersion: string | null;
  championDataSource: string | null;
  warnings: number;
}

/** riot/types.ts의 MatchDto → 엔진 입력. teamPosition이 없으면 빈 문자열(엔진이 NO_POSITION으로 판단) */
export function toAnalysisMatch(match: MatchDto): AnalysisMatch {
  return {
    ...match,
    info: {
      ...match.info,
      participants: match.info.participants.map((p) => ({ ...p, teamPosition: p.teamPosition ?? '' })),
    },
  };
}

const unsupported = (reason: string) =>
  new ApiError(422, 'ANALYSIS_UNSUPPORTED', '이 경기는 분석할 수 없습니다 (솔로·자유랭크 15분 이상 경기만).', { reason });
const notParticipant = () =>
  new ApiError(404, 'MATCH_NOT_FOUND', '이 소환사가 참가한 경기가 아닙니다.', { reason: 'participant' });

export function createFeedbackService(deps: FeedbackServiceDeps): FeedbackFn {
  const { riot, llm, ledger, champData, daily, budget, semaphore, breaker, logger } = deps;
  const now = deps.now ?? Date.now;
  const deadlineMs = deps.deadlineMs ?? FEEDBACK_DEADLINE_MS;
  const results = deps.resultCache ?? createSummonerCache<FeedbackDto>(FEEDBACK_CACHE_TTL_MS, FEEDBACK_CACHE_MAX);
  const templates = deps.templateCache ?? createSummonerCache<FeedbackDto>(FEEDBACK_TEMPLATE_CACHE_TTL_MS, FEEDBACK_TEMPLATE_CACHE_MAX);
  const flights = new Map<string, Promise<FeedbackDto>>();

  /** 지금 LLM을 부를 수 있나 (켜짐 + 하루 상한 > 0 + 차단기 닫힘) */
  const llmActive = (t: number) => llm.client !== null && daily.limit > 0 && !breaker.isOpen(t);

  const keyOf = (matchId: string, puuid: string) =>
    [matchId, puuid, ENGINE_VERSION, PROMPT_VERSION, FEEDBACK_KNOWLEDGE_VERSION ?? 'none', llm.model, llm.effort].join('|');

  const inputFactor = (): number => {
    const cal = calibration(ledger.entries(), llm.model, PROMPT_VERSION);
    return cal.samples > 0 ? cal.inputFactor : FEEDBACK_DEFAULT_INPUT_FACTOR;
  };

  /** 판당 최악 비용: 1차 max_tokens 전부 + 재시도 최악 (CLI 예상 비용과 같은 계산) */
  const worstUsd = (result: AnalysisResult, names: ReadonlyMap<number, string>, factor: number): number => {
    const sheet = buildFacts(result, names);
    const input =
      estimateTokens(SYSTEM_PROMPT, factor) +
      estimateTokens(JSON.stringify([{ role: 'user', content: buildUserMessage(sheet) }]), factor);
    return (
      worstCallCost(input, MAX_TOKENS.first, llm.model) +
      worstCallCost(input + MAX_TOKENS.first + FEEDBACK_RETRY_MSG_TOKENS, MAX_TOKENS.retry, llm.model)
    );
  };

  const dailyError = (t: number) => {
    const resetAt = daily.resetAt(t);
    return new ApiError(
      429,
      'ANALYSIS_LIMIT_REACHED',
      '오늘 분석 한도를 모두 썼습니다. 한국 시간 자정에 다시 열립니다.',
      { reason: 'daily', limit: daily.limit, resetAt: new Date(resetAt).toISOString() },
      Math.ceil((resetAt - t) / 1000),
    );
  };
  const budgetError = () => new ApiError(429, 'ANALYSIS_LIMIT_REACHED', '지금은 분석을 사용할 수 없습니다.', { reason: 'budget' });
  const busyError = (sec: number) =>
    new ApiError(503, 'ANALYSIS_BUSY', '분석 요청이 많습니다. 잠시 후 다시 시도해 주세요.', { retryAfterSec: sec }, sec);

  function mapRiotError(err: unknown, step: 'match' | 'timeline', puuid: string): never {
    if (err instanceof RiotNotFoundError) {
      if (step === 'match') throw new ApiError(404, 'MATCH_NOT_FOUND', '경기 정보를 찾을 수 없습니다.', { reason: 'match' });
      throw unsupported('no_timeline');
    }
    if (err instanceof RiotKeyExpiredError) {
      logger.error('Riot 키 만료로 분석 실패', { puuid: shortPuuid(puuid) });
      throw new ApiError(503, 'RIOT_KEY_EXPIRED', 'Riot API 키가 만료되어 조회할 수 없습니다.');
    }
    if (err instanceof RiotRetryExhaustedError) {
      logger.warn('Riot 재시도 소진으로 분석 실패', { puuid: shortPuuid(puuid) });
      throw new ApiError(502, 'RIOT_UNAVAILABLE', 'Riot API를 일시적으로 사용할 수 없습니다.');
    }
    throw err;
  }

  function mapAnalysisError(err: unknown, matchId: string): never {
    if (err instanceof AnalysisError) {
      if (err.code === 'PLAYER_NOT_FOUND') throw notParticipant();
      if (err.code === 'NO_POSITION') throw unsupported('no_position');
      if (err.code === 'NO_FRAMES') throw unsupported('no_timeline');
      logger.error('분석 엔진 오류', { matchId, code: err.code });
      throw new ApiError(500, 'INTERNAL_ERROR', '서버 오류가 발생했습니다.');
    }
    throw err;
  }

  /** 리더 요청만 실행: Riot → 사전 검사 → 엔진 → (예약) → 문장 → 정산 → 캐시 */
  async function analyze(matchId: string, puuid: string, key: string, stats: RunStats): Promise<FeedbackDto> {
    // ⑤ match
    let match: MatchDto;
    try {
      stats.riotCalls++;
      match = await riot.getMatch(matchId);
    } catch (err) {
      mapRiotError(err, 'match', puuid);
    }
    // ⑥ 사전 검사 (여기서 걸리면 timeline을 부르지 않는다)
    const pc = precheckMatch(match, puuid);
    if (!pc.ok) throw pc.status === 404 ? notParticipant() : unsupported(pc.reason);
    // ⑦ timeline
    let timeline: TimelineDto;
    try {
      stats.riotCalls++;
      timeline = await riot.getTimeline(matchId);
    } catch (err) {
      mapRiotError(err, 'timeline', puuid);
    }
    if (!Array.isArray(timeline?.info?.frames) || timeline.info.frames.length === 0) throw unsupported('no_timeline');
    // ⑧ 챔피언 데이터 (실패해도 스냅숏)
    const champ: ChampionData = await champData.forGameVersion(match.info.gameVersion);
    stats.championDataVersion = champ.version;
    stats.championDataSource = champ.source;
    // ⑨ 엔진
    let result: AnalysisResult;
    try {
      result = analyzeMatch({
        match: toAnalysisMatch(match),
        timeline: timeline as AnalysisTimeline,
        puuid,
        championTags: champ.tags,
      });
    } catch (err) {
      mapAnalysisError(err, matchId);
    }
    stats.warnings = result.warnings.length;

    // ⑩ LLM 여부
    const t = now();
    let client: LlmClient | null = null;
    let templateReason: TemplateReason = 'llm_off';
    if (llm.client !== null && daily.limit > 0) {
      if (breaker.isOpen(t)) templateReason = 'llm_error';
      else client = llm.client;
    }

    let dailyHeld = false;
    let budgetHold: number | null = null;
    let releaseSlot: (() => void) | null = null;
    let spentThisRun = 0;
    try {
      let factor = FEEDBACK_DEFAULT_INPUT_FACTOR;
      if (client) {
        // ⑪ 한도 예약: 하루 자리 → 예산(최악 비용) → 동시 실행 자리
        factor = inputFactor();
        if (!daily.tryReserve(now())) throw dailyError(now());
        dailyHeld = true;
        budgetHold = budget.tryReserve(worstUsd(result, champ.names, factor));
        if (budgetHold === null) {
          logger.warn('예산 상한으로 분석 거절', { matchId, spent: budget.spentUsd(), budget: budget.budgetUsd });
          throw budgetError();
        }
        releaseSlot = await semaphore.acquire();
        if (!releaseSlot) throw busyError(FEEDBACK_RETRY_AFTER_SEC);
      }
      // ⑫ 문장 (LLM 1~2회 → 검증 → 템플릿)
      const run = createFeedbackFromResult({
        client,
        model: llm.model,
        effort: llm.effort,
        budgetUsd: budget.budgetUsd,
        ledger,
        championNames: champ.names,
        now,
        inputFactor: factor,
      });
      const { feedback } = await run(result);
      stats.feedback = feedback;
      spentThisRun = feedback.meta.costUsd;

      const reason = feedback.meta.fallbackReason;
      if (reason === 'auth' || reason === 'billing' || reason === 'model_not_found') {
        if (breaker.open(now())) {
          logger.error(
            reason === 'billing' ? 'LLM 크레딧 소진(402). Anthropic 콘솔을 확인하세요. 10분 동안 템플릿 문장' : `LLM 호출 불가(${reason}). 10분 동안 템플릿 문장`,
            { matchId },
          );
        }
      }
      // 첫 호출 전에 예산에 걸렸으면 템플릿 대신 429 (05-3, 예약으로 거의 안 생김)
      if (client && reason === 'budget' && feedback.meta.attempts === 0) throw budgetError();

      // ⑬ DTO + 캐시
      const dto = toFeedbackDto(result, feedback, {
        templateReason: client ? 'llm_error' : templateReason,
        knowledgeVersion: FEEDBACK_KNOWLEDGE_VERSION,
        championDataVersion: champ.version,
        generatedAtMs: now(),
      });
      if (dto.mode === 'llm') results.set(key, dto, now());
      else templates.set(key, dto, now());
      return dto;
    } finally {
      // ⑬ 정산: 실제 비용이 0이면 하루 자리 반납, 예산 예약 해제, 동시 실행 자리 반환
      if (dailyHeld) daily.settle(spentThisRun > 0, now());
      if (budgetHold !== null) budget.release(budgetHold);
      releaseSlot?.();
    }
  }

  function logRun(matchId: string, puuid: string, cache: string, stats: RunStats, t0: number, outcome: string): void {
    const fb = stats.feedback;
    const v = fb?.meta.verification;
    const t = now();
    logger.info('분석', {
      matchId,
      puuid: shortPuuid(puuid),
      cache,
      outcome,
      riotCalls: stats.riotCalls,
      mode: fb?.mode ?? null,
      fallbackReason: fb?.meta.fallbackReason ?? null,
      attempts: fb?.meta.attempts ?? 0,
      first: v ? `${v.firstPass}/${v.firstTotal}` : null,
      retried: v?.retried ?? 0,
      templated: v?.templated ?? 0,
      tokens: fb ? `${fb.meta.usage.input}/${fb.meta.usage.cacheWrite}/${fb.meta.usage.cacheRead}/${fb.meta.usage.output}` : null,
      costUsd: fb ? Number(fb.meta.costUsd.toFixed(6)) : 0,
      llmMs: fb?.meta.durationMs ?? 0,
      totalMs: t - t0,
      today: `${daily.used(t)}/${daily.limit}`,
      spent: `$${budget.spentUsd().toFixed(4)}/$${budget.budgetUsd.toFixed(2)}`,
      championDataVersion: stats.championDataVersion,
      championDataSource: stats.championDataSource,
      engineWarnings: stats.warnings,
    });
  }

  return async function feedback(matchId, puuid) {
    const t0 = now();
    const key = keyOf(matchId, puuid);
    const quick = (cache: string, dto: FeedbackDto) => {
      logger.info('분석', { matchId, puuid: shortPuuid(puuid), cache, riotCalls: 0, mode: dto.mode, totalMs: now() - t0 });
      return dto;
    };

    // ③ 캐시: 결과 → 템플릿 → 진행 중
    const hit = results.get(key, t0);
    if (hit) return quick('hit', hit);
    const tHit = templates.get(key, t0);
    if (tHit && !(tHit.templateReason === 'llm_off' && llmActive(t0))) return quick('template_hit', tHit);

    let flight = flights.get(key);
    let cache = 'shared';
    if (!flight) {
      // ④ Riot 대기 확인 (리더만)
      const wait = riot.limiterWaitMs();
      if (wait > FEEDBACK_RIOT_MAX_WAIT_MS) {
        throw busyError(Math.min(FEEDBACK_BUSY_RETRY_MAX_SEC, Math.max(1, Math.ceil(wait / 1000))));
      }
      cache = 'miss';
      const stats: RunStats = { riotCalls: 0, feedback: null, championDataVersion: null, championDataSource: null, warnings: 0 };
      flight = analyze(matchId, puuid, key, stats).then(
        (dto) => {
          logRun(matchId, puuid, 'miss', stats, t0, 'ok');
          return dto;
        },
        (err: unknown) => {
          const code = err instanceof ApiError ? `${err.status} ${err.code}` : `error ${formatError(err)}`;
          logRun(matchId, puuid, 'miss', stats, t0, code);
          throw err;
        },
      );
      const created = flight;
      flights.set(key, created);
      // 리더가 끝나면(성공·실패 모두) 지운다. 아무도 기다리지 않는 실패가 처리되지 않은 거절로 남지 않게 catch
      created
        .finally(() => {
          if (flights.get(key) === created) flights.delete(key);
        })
        .catch(() => {});
    } else {
      logger.info('분석', { matchId, puuid: shortPuuid(puuid), cache, riotCalls: 0 });
    }

    // 응답 상한: 넘으면 504. 분석은 계속 돌고 끝나면 캐시에 들어간다
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        logger.warn('분석 응답 시간 초과(504). 분석은 계속 진행해 캐시에 넣습니다', { matchId, puuid: shortPuuid(puuid), cache });
        reject(
          new ApiError(
            504,
            'ANALYSIS_TIMEOUT',
            '분석이 오래 걸리고 있습니다. 잠시 후 다시 눌러 주세요.',
            { retryAfterSec: FEEDBACK_RETRY_AFTER_SEC },
            FEEDBACK_RETRY_AFTER_SEC,
          ),
        );
      }, deadlineMs);
    });
    try {
      return await Promise.race([flight, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
}
