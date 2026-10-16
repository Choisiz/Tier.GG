// ②~⑤ 게임 ID(startTime) → 상세(시작 시각·창 상한) → 타임라인 → 게임 단위 트랜잭션 저장 (back_spec 3-2 ~ 3-5, 변경 01-4)
// 집계는 하지 않는다 (매일 05:00 KST DB 예약 작업)
import pg from 'pg';
import { withTransaction } from '../db/tx.js';
import { isDbConnectionError } from '../db/pool.js';
import { formatError, shortPuuid } from '../lib/logger.js';
import {
  RiotBadRequestError,
  RiotKeyExpiredError,
  RiotNotFoundError,
  RiotRetryExhaustedError,
} from '../riot/errors.js';
import {
  countMatchesSince,
  existingMatchIds,
  listSamplePuuids,
  saveMatch,
} from '../repositories/rawRepository.js';
import { TooManyFailuresError, UserAbortError, type CollectorContext } from './context.js';
import {
  emptyWarnings,
  prefilterMatch,
  transformMatch,
  type SkipReason,
  type TransformWarnings,
} from './transform.js';

export type MatchSkip = SkipReason | 'duplicate';

export interface MatchesResult {
  players: number;
  playersFailed: number;
  /** 창 안 게임이 0개인 플레이어 (② 빈 목록, 정상) */
  playersNoGames: number;
  /** 0 준비 단계에서 센 창 안 게임 수 (창 상한 계산용) */
  inWindowBefore: number;
  idsFound: number;
  idsNew: number;
  processed: number;
  saved: number;
  failed: number;
  skipped: Record<MatchSkip, number>;
  warnings: TransformWarnings;
  /** 요약 로그용 (집계에는 쓰지 않음) */
  savedPatches: Set<string>;
  /** 'aborted'·'failed'는 cli/collect.ts가 예외로 끝났을 때 요약 로그용으로 맞춘다 (02-3, L2). 기본값은 'done' */
  stoppedBy: 'done' | 'max_matches' | 'window_full' | 'aborted' | 'failed';
}

/** 'KR_8408851980' → 8408851980n (숫자 내림차순 정렬용) */
function idNumber(id: string): bigint {
  const m = /_(\d+)$/.exec(id);
  return m ? BigInt(m[1] as string) : 0n;
}

export function sortIdsNewestFirst(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const x = idNumber(a);
    const y = idNumber(b);
    return x === y ? 0 : x > y ? -1 : 1;
  });
}

/** 게임 하나만 건너뛰면 되는 오류인지 (키 만료·DB 연결 끊김·예상 못한 오류는 아님) */
function isPerMatchError(err: unknown): boolean {
  if (err instanceof RiotKeyExpiredError) return false;
  if (err instanceof RiotNotFoundError || err instanceof RiotBadRequestError || err instanceof RiotRetryExhaustedError) {
    return true;
  }
  // DB 제약 위반·데이터 형식 오류(23xxx, 22xxx)는 그 게임만의 문제
  if (err instanceof pg.DatabaseError && !isDbConnectionError(err)) {
    const code = err.code ?? '';
    return code.startsWith('23') || code.startsWith('22');
  }
  return false;
}

export function createMatchesResult(): MatchesResult {
  return {
    players: 0,
    playersFailed: 0,
    playersNoGames: 0,
    inWindowBefore: 0,
    idsFound: 0,
    idsNew: 0,
    processed: 0,
    saved: 0,
    failed: 0,
    skipped: { not_solo: 0, too_short: 0, not_10_players: 0, out_of_window: 0, bad_format: 0, duplicate: 0 },
    warnings: emptyWarnings(),
    savedPatches: new Set(),
    stoppedBy: 'done',
  };
}

/** out을 넘기면 중간에 오류가 나도 그때까지의 개수(저장 수 등)가 out에 남는다 */
export async function runMatches(ctx: CollectorContext, out: MatchesResult = createMatchesResult()): Promise<MatchesResult> {
  const { cfg, riotCfg, logger, riot, pool, window } = ctx;
  const filterOpts = { queue: cfg.queue, minGameDurationSec: cfg.minGameDurationSec, windowStartMs: window.startMs };

  // 0 준비: 창 안에 이미 저장된 게임 수 (창 상한)
  out.inWindowBefore = await countMatchesSince(pool, new Date(window.startMs));
  logger.info('창', {
    windowStart: new Date(window.startMs).toISOString(),
    startTime: window.startTimeSec,
    days: cfg.windowDays,
    inWindow: out.inWindowBefore,
    maxGamesPerWindow: cfg.maxGamesPerWindow,
  });

  // ② 게임 ID (startTime = 창 시작, 초)
  const puuids = await listSamplePuuids(pool, cfg.tiers);
  out.players = puuids.length;
  logger.info('② 게임 ID 시작', {
    players: puuids.length,
    path: `/lol/match/v5/matches/by-puuid/…/ids?queue=${cfg.queue}&start=0&count=${cfg.gamesPerPlayer}&startTime=${window.startTimeSec}`,
  });
  const firstFinder = new Map<string, string>();
  let idsConsecutiveFailures = 0;
  for (const [i, puuid] of puuids.entries()) {
    if (ctx.stop.requested) throw new UserAbortError();
    try {
      const ids = await riot.getMatchIds(puuid, {
        queue: cfg.queue,
        start: 0,
        count: cfg.gamesPerPlayer,
        startTime: window.startTimeSec,
      });
      out.idsFound += ids.length;
      if (ids.length === 0) out.playersNoGames++;
      for (const id of ids) if (!firstFinder.has(id)) firstFinder.set(id, puuid);
      idsConsecutiveFailures = 0;
    } catch (err) {
      if (!isPerMatchError(err)) throw err;
      out.playersFailed++;
      idsConsecutiveFailures++;
      logger.warn('② 플레이어 건너뜀', { puuid: shortPuuid(puuid), error: formatError(err), consecutive: idsConsecutiveFailures });
      // ③~⑤와 같은 상한을 재사용 (Riot 쪽 장애 신호라는 점에서 같은 기준이면 충분, 02-4·L3)
      if (idsConsecutiveFailures >= riotCfg.maxConsecutiveMatchFailures) {
        throw new TooManyFailuresError(`② 게임 ID 조회 연속 ${idsConsecutiveFailures}개 실패`);
      }
    }
    if ((i + 1) % 50 === 0) logger.info('② 진행', { done: i + 1, of: puuids.length, unique: firstFinder.size });
  }
  const existing = await existingMatchIds(pool, [...firstFinder.keys()]);
  const todo = sortIdsNewestFirst([...firstFinder.keys()].filter((id) => !existing.has(id)));
  out.idsNew = todo.length;
  logger.info('② 게임 ID 끝', {
    found: out.idsFound,
    unique: firstFinder.size,
    alreadySaved: existing.size,
    todo: todo.length,
    playersNoGames: out.playersNoGames,
  });

  const target = cfg.maxMatchesPerRun === null ? todo.length : Math.min(todo.length, cfg.maxMatchesPerRun);
  const started = Date.now();
  let consecutiveFailures = 0;

  const progress = () => {
    const elapsedSec = (Date.now() - started) / 1000;
    const rate = out.processed > 0 ? elapsedSec / out.processed : 0;
    logger.info('③~⑤ 진행', {
      saved: out.saved,
      target,
      processed: out.processed,
      of: todo.length,
      failed: out.failed,
      skipped: JSON.stringify(out.skipped),
      elapsedSec: Math.round(elapsedSec),
      etaSec: Math.round(rate * Math.max(0, (cfg.maxMatchesPerRun === null ? todo.length - out.processed : target - out.saved))),
      calls: riot.stats.calls,
    });
  };

  for (const matchId of todo) {
    if (cfg.maxMatchesPerRun !== null && out.saved >= cfg.maxMatchesPerRun) {
      out.stoppedBy = 'max_matches';
      break;
    }
    // 창 상한: 창 안 게임은 모두 같은 창이라 하나씩 건너뛰지 않고 ③ 전에 멈춘다 (결정 D15)
    if (out.inWindowBefore + out.saved >= cfg.maxGamesPerWindow) {
      out.stoppedBy = 'window_full';
      logger.warn('창 상한에 닿아 멈춤', { inWindow: out.inWindowBefore + out.saved, maxGamesPerWindow: cfg.maxGamesPerWindow });
      break;
    }
    if (ctx.stop.requested) throw new UserAbortError();
    out.processed++;
    try {
      // ③ 상세
      const match = await riot.getMatch(matchId);
      const pre = prefilterMatch(match, filterOpts);
      if (!pre.ok) {
        out.skipped[pre.reason]++;
        consecutiveFailures = 0;
        continue;
      }
      // ④ 타임라인
      const timeline = await riot.getTimeline(matchId);
      const t = transformMatch(match, timeline, firstFinder.get(matchId) ?? null, filterOpts);
      if (!t.ok) {
        out.skipped[t.reason]++;
        logger.warn('게임 건너뜀', { matchId, reason: t.reason, detail: t.detail });
        consecutiveFailures = 0;
        continue;
      }
      // ⑤ 저장: 게임 1개 = 트랜잭션 1개. 이미 있으면(다른 실행이 저장) ROLLBACK
      const r = await withTransaction(
        pool,
        async (client) => {
          const res = await saveMatch(client, t.match, t.players);
          if (res === 'duplicate') throw new DuplicateSignal();
          return res;
        },
        logger,
      ).catch((err: unknown) => {
        if (err instanceof DuplicateSignal) return 'duplicate' as const;
        throw err;
      });
      consecutiveFailures = 0;
      if (r === 'duplicate') {
        out.skipped.duplicate++;
        continue;
      }
      out.saved++;
      out.savedPatches.add(t.match.patch);
      out.warnings.banUnmatched += t.warnings.banUnmatched;
      out.warnings.badPosition += t.warnings.badPosition;
      out.warnings.badSkillSlot += t.warnings.badSkillSlot;
    } catch (err) {
      if (!isPerMatchError(err)) throw err;
      out.failed++;
      consecutiveFailures++;
      logger.warn('게임 실패, 건너뜀', { matchId, error: formatError(err), consecutive: consecutiveFailures });
      if (consecutiveFailures >= riotCfg.maxConsecutiveMatchFailures) {
        throw new TooManyFailuresError(`게임 연속 ${consecutiveFailures}개 실패`);
      }
    } finally {
      if (out.processed % 50 === 0) progress();
    }
  }
  progress();
  return out;
}

class DuplicateSignal extends Error {}
