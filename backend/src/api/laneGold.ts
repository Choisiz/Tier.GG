// 라인전 15분 골드 (back_spec 변경 04, 04-2·04-6·04-7).
// 계산 순수 함수(pairForLane, extractGold15, gold15Result) + 서비스(createLaneGold: 캐시·진행 중 공유·한도 정책·오류 매핑).
import type { Logger } from '../lib/logger.js';
import { shortPuuid } from '../lib/logger.js';
import {
  LANE_GOLD_CONCURRENCY,
  LANE_GOLD_FRAME_INDEX,
  LANE_GOLD_MAX_WAIT_MS,
  LANE_GOLD_MIN_DURATION_SEC,
  LANE_GOLD_RETRY_MAX_SEC,
} from '../config/summoner.js';
import type { RiotClient } from '../riot/client.js';
import { RiotKeyExpiredError, RiotNotFoundError, RiotRetryExhaustedError } from '../riot/errors.js';
import type { TimelineDto } from '../riot/types.js';
import { ApiError } from './errors.js';
import { laneInfoFromMatch, type LanePlayer, type MatchLaneCache, type MatchLaneInfo } from './matchLaneCache.js';

export type LaneGoldState = 'ready' | 'unavailable' | 'pending';

export interface LaneGoldItem {
  matchId: string;
  state: LaneGoldState;
  myPercent: number | null;
  myGold: number | null;
  enemyGold: number | null;
}

export interface LaneGoldResponse {
  results: LaneGoldItem[];
  retryAfterSec: number | null;
}

export type LaneGoldFn = (puuid: string, matchIds: string[]) => Promise<LaneGoldResponse>;

// ───────── 순수 함수 ─────────

/** 나와 상대(적 팀의 같은 포지션 정확히 1명). 포지션이 없거나 상대가 0·2명 이상이면 null (04-2 ②③) */
export function pairForLane(players: LanePlayer[], puuid: string): { me: LanePlayer; enemy: LanePlayer } | null {
  const me = players.find((p) => p.puuid === puuid);
  if (!me || me.position === null) return null;
  const enemies = players.filter((p) => p.teamId !== me.teamId && p.position === me.position);
  if (enemies.length !== 1) return null;
  return { me, enemy: enemies[0] as LanePlayer };
}

/**
 * timeline → participantId별 15:00 totalGold. frames가 16개 미만이면 null (게임이 15분 전에 끝남, 04-2 ①).
 * totalGold가 숫자인 참가자만 담는다 (없는 참가자는 키 없음).
 */
export function extractGold15(timeline: TimelineDto): Record<number, number> | null {
  const frames = timeline.info?.frames;
  if (!Array.isArray(frames) || frames.length <= LANE_GOLD_FRAME_INDEX) return null;
  const pf = frames[LANE_GOLD_FRAME_INDEX]?.participantFrames;
  if (!pf) return null;
  const out: Record<number, number> = {};
  for (const [key, frame] of Object.entries(pf)) {
    const id = Number(key);
    if (Number.isInteger(id) && typeof frame?.totalGold === 'number' && Number.isFinite(frame.totalGold)) {
      out[id] = frame.totalGold;
    }
  }
  return out;
}

/** 경기 정보 + gold15 + puuid → ready/unavailable 값. 계산 불가면 null (04-2 ④, 0/0) */
export function gold15Result(
  info: MatchLaneInfo,
  puuid: string,
): { myPercent: number; myGold: number; enemyGold: number } | null {
  if (!info.gold15) return null;
  const pair = pairForLane(info.players, puuid);
  if (!pair) return null;
  const myGold = info.gold15[pair.me.participantId];
  const enemyGold = info.gold15[pair.enemy.participantId];
  if (typeof myGold !== 'number' || typeof enemyGold !== 'number') return null;
  const total = myGold + enemyGold;
  if (total <= 0) return null;
  return { myPercent: Math.round((myGold * 100) / total), myGold, enemyGold };
}

// ───────── 서비스 ─────────

/** laneGold가 Riot에 요구하는 것만. 테스트에서 가짜로 바꿔 끼운다 */
export type LaneGoldRiot = Pick<RiotClient, 'getMatch' | 'getTimeline' | 'limiterWaitMs'>;

export interface LaneGoldDeps {
  riot: LaneGoldRiot;
  cache: MatchLaneCache;
  logger: Logger;
  now?: () => number;
}

const PENDING = Symbol('pending');
type Pending = typeof PENDING;

interface RequestCtx {
  /** 한도 때문에 더 이상 새 Riot 호출을 시작하지 않음 */
  stopped: boolean;
  maxWaitMs: number;
  riotCalls: number;
  /** 새 Riot 호출 없이 끝난 경기 수(캐시 적중 또는 진행 중인 호출에 합류) */
  hits: number;
  error: unknown;
}

const unavailable = (matchId: string): LaneGoldItem => ({ matchId, state: 'unavailable', myPercent: null, myGold: null, enemyGold: null });
const pending = (matchId: string): LaneGoldItem => ({ matchId, state: 'pending', myPercent: null, myGold: null, enemyGold: null });

export function createLaneGold({ riot, cache, logger, now = Date.now }: LaneGoldDeps): LaneGoldFn {
  // 같은 matchId를 동시에 두 요청이 가져가도 Riot은 한 번만 부른다 (진행 중 Promise 공유)
  const infoFlights = new Map<string, Promise<void>>();
  const goldFlights = new Map<string, Promise<void>>();

  /** 새 호출을 시작하기 전 제한기 대기를 본다. 이미 진행 중이면 합류(새 호출 없음) */
  async function runFlight(
    flights: Map<string, Promise<void>>,
    matchId: string,
    ctx: RequestCtx,
    start: () => Promise<void>,
  ): Promise<Pending | 'started' | 'joined'> {
    const existing = flights.get(matchId);
    if (existing) {
      await existing;
      return 'joined';
    }
    if (ctx.stopped) return PENDING;
    const wait = riot.limiterWaitMs();
    if (wait > LANE_GOLD_MAX_WAIT_MS) {
      ctx.stopped = true;
      ctx.maxWaitMs = Math.max(ctx.maxWaitMs, wait);
      return PENDING;
    }
    ctx.riotCalls++;
    const flight = start().finally(() => flights.delete(matchId));
    flights.set(matchId, flight);
    await flight;
    return 'started';
  }

  async function fetchInfo(matchId: string): Promise<void> {
    try {
      const match = await riot.getMatch(matchId);
      cache.set(matchId, laneInfoFromMatch(match), now());
    } catch (err) {
      if (!(err instanceof RiotNotFoundError)) throw err;
      // 모르는 경기: 다시 부르지 않게 빈 정보 + gold15=null로 기억
      cache.set(matchId, { durationSec: 0, players: [], gold15: null }, now());
    }
  }

  async function fetchGold(matchId: string): Promise<void> {
    const info = cache.get(matchId, now());
    if (!info) return;
    let gold15: Record<number, number> | null;
    try {
      gold15 = extractGold15(await riot.getTimeline(matchId));
    } catch (err) {
      if (!(err instanceof RiotNotFoundError)) throw err;
      gold15 = null;
    }
    // timeline 원본은 버리고 숫자만 남긴다
    cache.set(matchId, { ...info, gold15 }, now());
  }

  async function resolveOne(matchId: string, puuid: string, ctx: RequestCtx): Promise<LaneGoldItem> {
    let called = false;
    const item = await (async (): Promise<LaneGoldItem> => {
      let info = cache.get(matchId, now());
      if (!info) {
        const r = await runFlight(infoFlights, matchId, ctx, () => fetchInfo(matchId));
        if (r === PENDING) return pending(matchId);
        if (r === 'started') called = true;
        info = cache.get(matchId, now());
        if (!info) return unavailable(matchId); // 방금 넣었는데 밀려난 경우(캐시 크기 극단값)
      }
      if (info.gold15 === undefined) {
        // 호출 생략: 15분 미만이거나 이 puuid가 라인전 대상이 아니면 timeline을 부르지 않는다 (04-2)
        if (info.durationSec < LANE_GOLD_MIN_DURATION_SEC || !pairForLane(info.players, puuid)) return unavailable(matchId);
        const r = await runFlight(goldFlights, matchId, ctx, () => fetchGold(matchId));
        if (r === PENDING) return pending(matchId);
        if (r === 'started') called = true;
        info = cache.get(matchId, now());
        if (!info || info.gold15 === undefined) return unavailable(matchId);
      }
      const r = gold15Result(info, puuid);
      return r ? { matchId, state: 'ready', ...r } : unavailable(matchId);
    })();
    if (!called && item.state !== 'pending') ctx.hits++;
    return item;
  }

  return async function laneGold(puuid, matchIds) {
    const ctx: RequestCtx = { stopped: false, maxWaitMs: 0, riotCalls: 0, hits: 0, error: undefined };
    const results: LaneGoldItem[] = new Array<LaneGoldItem>(matchIds.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (ctx.error === undefined) {
        const i = next++;
        if (i >= matchIds.length) return;
        const matchId = matchIds[i] as string;
        try {
          results[i] = await resolveOne(matchId, puuid, ctx);
        } catch (err) {
          ctx.error = err;
          ctx.stopped = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(LANE_GOLD_CONCURRENCY, matchIds.length) }, worker));

    if (ctx.error !== undefined) {
      const err = ctx.error;
      if (err instanceof RiotKeyExpiredError) {
        // 매 요청마다 로그(제한 없음, 결정 W5와 같음). 이 요청만 실패하고 서버는 멈추지 않는다.
        logger.error('Riot 키 만료로 라인전 조회 실패', { puuid: shortPuuid(puuid) });
        throw new ApiError(503, 'RIOT_KEY_EXPIRED', 'Riot API 키가 만료되어 조회할 수 없습니다.');
      }
      if (err instanceof RiotRetryExhaustedError) {
        logger.warn('Riot 재시도 소진으로 라인전 조회 실패', { puuid: shortPuuid(puuid), riotCalls: ctx.riotCalls });
        throw new ApiError(502, 'RIOT_UNAVAILABLE', 'Riot API를 일시적으로 사용할 수 없습니다.');
      }
      throw err;
    }

    const count = (s: LaneGoldState) => results.filter((r) => r.state === s).length;
    const pendingCount = count('pending');
    const retryAfterSec =
      pendingCount > 0 ? Math.min(LANE_GOLD_RETRY_MAX_SEC, Math.max(1, Math.ceil(ctx.maxWaitMs / 1000))) : null;
    logger.info('라인전 15분 골드', {
      puuid: shortPuuid(puuid),
      ready: count('ready'),
      unavailable: count('unavailable'),
      pending: pendingCount,
      riotCalls: ctx.riotCalls,
      cacheHits: ctx.hits,
    });
    return { results, retryAfterSec };
  };
}
