// ②~⑤ 게임 ID → 상세 → 타임라인 → 게임 단위 트랜잭션 저장 (back_spec 3-2 ~ 3-5)
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
  existingMatchIds,
  listSamplePuuids,
  matchCountsByPatch,
  saveMatch,
} from '../repositories/rawRepository.js';
import { TooManyFailuresError, UserAbortError, type CollectorContext } from './context.js';
import {
  emptyWarnings,
  latestPatches,
  prefilterMatch,
  transformMatch,
  type SkipReason,
  type TransformWarnings,
} from './transform.js';

export type MatchSkip = SkipReason | 'patch_full' | 'duplicate';

export interface MatchesResult {
  players: number;
  playersFailed: number;
  idsFound: number;
  idsNew: number;
  processed: number;
  saved: number;
  failed: number;
  skipped: Record<MatchSkip, number>;
  warnings: TransformWarnings;
  savedPatches: Set<string>;
  stoppedBy: 'done' | 'max_matches';
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
    idsFound: 0,
    idsNew: 0,
    processed: 0,
    saved: 0,
    failed: 0,
    skipped: { not_solo: 0, too_short: 0, not_10_players: 0, old_patch: 0, bad_format: 0, patch_full: 0, duplicate: 0 },
    warnings: emptyWarnings(),
    savedPatches: new Set(),
    stoppedBy: 'done',
  };
}

/** out을 넘기면 중간에 오류가 나도 그때까지의 개수(저장 수 등)가 out에 남는다 */
export async function runMatches(ctx: CollectorContext, out: MatchesResult = createMatchesResult()): Promise<MatchesResult> {
  const { cfg, riotCfg, logger, riot, pool } = ctx;

  // ② 게임 ID
  const puuids = await listSamplePuuids(pool, cfg.tiers);
  out.players = puuids.length;
  logger.info('② 게임 ID 시작', { players: puuids.length, count: cfg.gamesPerPlayer, queue: cfg.queue });
  const firstFinder = new Map<string, string>();
  for (const [i, puuid] of puuids.entries()) {
    if (ctx.stop.requested) throw new UserAbortError();
    try {
      const ids = await riot.getMatchIds(puuid, { queue: cfg.queue, start: 0, count: cfg.gamesPerPlayer });
      out.idsFound += ids.length;
      for (const id of ids) if (!firstFinder.has(id)) firstFinder.set(id, puuid);
    } catch (err) {
      if (!isPerMatchError(err)) throw err;
      out.playersFailed++;
      logger.warn('② 플레이어 건너뜀', { puuid: shortPuuid(puuid), error: formatError(err) });
    }
    if ((i + 1) % 50 === 0) logger.info('② 진행', { done: i + 1, of: puuids.length, unique: firstFinder.size });
  }
  const existing = await existingMatchIds(pool, [...firstFinder.keys()]);
  const todo = sortIdsNewestFirst([...firstFinder.keys()].filter((id) => !existing.has(id)));
  out.idsNew = todo.length;
  logger.info('② 게임 ID 끝', { found: out.idsFound, unique: firstFinder.size, alreadySaved: existing.size, todo: todo.length });

  // 보관 패치 창: matches에 있는 패치 ∪ 이번 실행에서 본 패치 중 최신 keepPatches개
  const perPatch = await matchCountsByPatch(pool);
  const seenPatches = new Set<string>(perPatch.keys());
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
    if (ctx.stop.requested) throw new UserAbortError();
    out.processed++;
    try {
      // ③ 상세
      const match = await riot.getMatch(matchId);
      const pre = prefilterMatch(match, cfg);
      if (!pre.ok) {
        out.skipped[pre.reason]++;
        consecutiveFailures = 0;
        continue;
      }
      seenPatches.add(pre.patch);
      if (!latestPatches(seenPatches, cfg.keepPatches).includes(pre.patch)) {
        out.skipped.old_patch++;
        consecutiveFailures = 0;
        continue;
      }
      if ((perPatch.get(pre.patch) ?? 0) >= cfg.maxGamesPerPatch) {
        out.skipped.patch_full++;
        consecutiveFailures = 0;
        continue;
      }
      // ④ 타임라인
      const timeline = await riot.getTimeline(matchId);
      const t = transformMatch(match, timeline, firstFinder.get(matchId) ?? null, cfg);
      if (!t.ok) {
        out.skipped[t.reason]++;
        logger.warn('게임 건너뜀', { matchId, reason: t.reason, detail: t.detail });
        consecutiveFailures = 0;
        continue;
      }
      // ⑤ 저장: 게임 1개 = 트랜잭션 1개. 이미 있으면(다른 실행이 저장) ROLLBACK
      const r = await withTransaction(pool, async (client) => {
        const res = await saveMatch(client, t.match, t.players);
        if (res === 'duplicate') throw new DuplicateSignal();
        return res;
      }).catch((err: unknown) => {
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
      perPatch.set(t.match.patch, (perPatch.get(t.match.patch) ?? 0) + 1);
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
