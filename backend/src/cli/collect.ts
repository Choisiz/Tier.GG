// 진입점 2: 수집 CLI
// npm run collect -- <run|sample|matches|aggregate|purge> [옵션]
// 종료 코드: 0 정상, 1 실패, 2 키 만료(401/403), 3 다른 수집이 실행 중, 130 사용자 중단(Ctrl+C)
import { parseArgs } from 'node:util';
import type pg from 'pg';
import {
  buildCollectionConfig,
  ConfigError,
  RIOT_CLIENT_CONFIG,
  windowStart,
  type CollectionConfig,
} from '../config/collection.js';
import { EnvError, loadDbEnv, loadRiotEnv } from '../config/env.js';
import { createPool, isDbConnectionError } from '../db/pool.js';
import { createLogger, formatError, type Logger } from '../lib/logger.js';
import { RiotClient } from '../riot/client.js';
import { RiotKeyExpiredError } from '../riot/errors.js';
import { RateLimiter } from '../riot/rateLimiter.js';
import { aggregateWindowOnPool, planPurgeGames, type WindowAggregate } from '../collector/aggregate.js';
import { TooManyFailuresError, UserAbortError, type CollectorContext } from '../collector/context.js';
import { createMatchesResult, runMatches, type MatchesResult } from '../collector/matches.js';
import { CollectorLock, CollectorLockedError, RunLog } from '../collector/runLog.js';
import { runSample } from '../collector/sample.js';
import { countRankedPlayersByTier } from '../repositories/rawRepository.js';

const USAGE = `사용법: npm run collect -- <명령> [옵션]
  run        ①~⑤ 표본(없으면) → 최근 14일 게임 수집 (집계 없음)
  sample     ① 표본만 (--resample: 이미 있어도 다시 뽑아 더함)
  matches    ②~⑤ 저장된 표본으로 게임만 수집 (집계 없음)
  aggregate  (시험용) ANALYZE + refresh_window_stats(14). 평소에는 매일 05:00 KST DB 예약 작업이 한다
  purge      21일보다 오래된 원본 삭제 미리보기 (--yes를 붙여야 purge_old_games(21)로 실제 삭제)
옵션: --preset test|main  --max-matches N  --players-per-tier N  --games-per-player N
      --tiers PLATINUM,EMERALD,DIAMOND  --seed N  --resample  --yes`;

const AGGREGATE_NOTE = '집계는 매일 05:00 KST DB 예약 작업이 한다. 바로 보려면 npm run collect -- aggregate (시험용)';

const EXIT = { ok: 0, failed: 1, keyExpired: 2, locked: 3, aborted: 130 } as const;

interface Args {
  command: string;
  preset: string;
  maxMatches?: number;
  playersPerTier?: number;
  gamesPerPlayer?: number;
  tiers?: string[];
  seed?: number;
  resample: boolean;
  yes: boolean;
}

function intOpt(name: string, v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (!/^[0-9]+$/.test(v)) throw new ConfigError(`${name}는 정수여야 합니다: ${v}`);
  return Number(v);
}

function parseCli(argv: string[]): Args {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      preset: { type: 'string', default: 'test' },
      'max-matches': { type: 'string' },
      'players-per-tier': { type: 'string' },
      'games-per-player': { type: 'string' },
      tiers: { type: 'string' },
      seed: { type: 'string' },
      resample: { type: 'boolean', default: false },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const command = positionals[0] ?? (values.help ? 'help' : '');
  return {
    command,
    preset: values.preset ?? 'test',
    maxMatches: intOpt('--max-matches', values['max-matches']),
    playersPerTier: intOpt('--players-per-tier', values['players-per-tier']),
    gamesPerPlayer: intOpt('--games-per-player', values['games-per-player']),
    tiers: values.tiers?.split(','),
    seed: intOpt('--seed', values.seed),
    resample: values.resample ?? false,
    yes: values.yes ?? false,
  };
}

function makeContext(
  pool: pg.Pool,
  cfg: CollectionConfig,
  logger: Logger,
  stop: { requested: boolean },
  window: CollectorContext['window'],
): CollectorContext {
  const env = loadRiotEnv();
  const limiter = new RateLimiter({
    perSecond: RIOT_CLIENT_CONFIG.perSecondLimit,
    perWindow: RIOT_CLIENT_CONFIG.perWindowLimit,
    windowMs: RIOT_CLIENT_CONFIG.windowMs,
  });
  const riot = new RiotClient({
    apiKey: env.apiKey,
    platformUrl: env.platformUrl,
    regionUrl: env.regionUrl,
    limiter,
    config: RIOT_CLIENT_CONFIG,
    logger: createLogger('riot'),
  });
  return { pool, riot, cfg, riotCfg: RIOT_CLIENT_CONFIG, logger, window, stop };
}

function summarize(logger: Logger, ctx: CollectorContext | null, m: MatchesResult | null, t0: number) {
  logger.info('요약', {
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    riotCalls: ctx?.riot.stats.calls ?? 0,
    riot429: ctx?.riot.stats.status429 ?? 0,
    riotRetries: ctx?.riot.stats.retries ?? 0,
    riotByStatus: ctx ? JSON.stringify(ctx.riot.stats.byStatus) : '{}',
    appRateCount: ctx?.riot.stats.lastAppRateCount ?? null,
    limiterWaitSec: ctx ? Math.round(ctx.riot.limiterWaitedMs / 1000) : 0,
  });
  if (m) {
    logger.info('요약 게임', {
      players: m.players,
      playersFailed: m.playersFailed,
      playersNoGames: m.playersNoGames,
      inWindowBefore: m.inWindowBefore,
      idsFound: m.idsFound,
      idsNew: m.idsNew,
      processed: m.processed,
      saved: m.saved,
      failed: m.failed,
      stoppedBy: m.stoppedBy,
      skipped: JSON.stringify(m.skipped),
      warnings: JSON.stringify(m.warnings),
      patches: [...m.savedPatches].join(',') || '-',
    });
  }
}

/** run / sample / matches: Riot을 부르고 collection_logs를 남긴다 */
async function collectCommand(args: Args, pool: pg.Pool, logger: Logger, stop: { requested: boolean }): Promise<number> {
  const cfg = buildCollectionConfig(args.preset, {
    tiers: args.tiers,
    playersPerTier: args.playersPerTier,
    gamesPerPlayer: args.gamesPerPlayer,
    maxMatches: args.maxMatches,
  });
  logger.info('설정', {
    command: args.command,
    preset: cfg.preset,
    tiers: cfg.tiers.join(','),
    playersPerTier: cfg.playersPerTier,
    gamesPerPlayer: cfg.gamesPerPlayer,
    maxMatches: cfg.maxMatchesPerRun,
    windowDays: cfg.windowDays,
    limits: `${RIOT_CLIENT_CONFIG.perSecondLimit}/1s,${RIOT_CLIENT_CONFIG.perWindowLimit}/${RIOT_CLIENT_CONFIG.windowMs / 1000}s`,
  });
  const t0 = Date.now();
  // 잠금 연결이 끊기면(DB 연결 끊김) 지금 게임 뒤 멈추고 failed로 기록한다 (back_spec 3-5)
  const lock = await CollectorLock.acquire(pool, (err) => {
    stop.requested = true;
    logger.error('DB 연결 끊김: 수집 잠금 연결이 끊겨 지금 게임 뒤 멈춤', { error: formatError(err) });
  });
  // 0 준비: 창 시작 시각은 여기서 한 번 정해 모든 플레이어(②)와 거르기(③)에 같은 값을 쓴다
  const w = windowStart(Date.now(), cfg.windowDays);
  const ctx = makeContext(pool, cfg, logger, stop, { startMs: w.ms, startTimeSec: w.sec });
  let log: RunLog | null = null;
  let m: MatchesResult | null = null;
  try {
    log = await RunLog.start(pool, logger);
    try {
      if (args.command === 'sample') {
        await runSample(ctx, { resample: args.resample, seed: args.seed });
        const n = [...(await countRankedPlayersByTier(pool, cfg.tiers)).values()].reduce((a, b) => a + b, 0);
        await log.finish('done', n, 0, null);
        summarize(logger, ctx, null, t0);
        return EXIT.ok;
      }
      if (args.command === 'run') await runSample(ctx, { resample: args.resample, seed: args.seed });
      m = createMatchesResult();
      await runMatches(ctx, m);
      // 창 상한·--max-matches로 멈춰도 done
      await log.finish('done', m.players, m.saved, null);
      summarize(logger, ctx, m, t0);
      logger.info(AGGREGATE_NOTE);
      return EXIT.ok;
    } catch (err) {
      // runMatches가 중간에 던져도 m에 그때까지 저장한 수가 남아 있다
      const saved = m?.saved ?? 0;
      const players = m && m.players > 0 ? m.players : null;
      if (err instanceof RiotKeyExpiredError) {
        logger.error('Riot 키 만료(401/403). 수집을 멈춤. 키를 재발급해 .env에 넣고 같은 명령을 다시 실행하세요 (저장한 게임은 건너뜀).', {
          status: err.status,
          path: err.path,
        });
        await log.finish('key_expired', players, saved, `Riot 키 만료 (HTTP ${err.status})`);
        summarize(logger, ctx, m, t0);
        return EXIT.keyExpired;
      }
      if (err instanceof UserAbortError && lock.lost) {
        const msg = 'DB 연결 끊김 (수집 잠금 연결)';
        await log.finish('failed', players, saved, msg).catch((e: unknown) => logger.error('collection_logs 기록 실패', { error: formatError(e) }));
        summarize(logger, ctx, m, t0);
        return EXIT.failed;
      }
      if (err instanceof UserAbortError) {
        logger.warn('사용자 중단');
        await log.finish('failed', players, saved, '사용자 중단');
        summarize(logger, ctx, m, t0);
        return EXIT.aborted;
      }
      const msg = formatError(err);
      logger.error('수집 실패', { error: msg, kind: err instanceof TooManyFailuresError ? 'too_many_failures' : isDbConnectionError(err) ? 'db' : 'unexpected' });
      if (err instanceof Error && err.stack && !(err instanceof TooManyFailuresError)) logger.error(formatError(err.stack));
      await log.finish('failed', players, saved, msg).catch((e: unknown) => logger.error('collection_logs 기록 실패', { error: formatError(e) }));
      summarize(logger, ctx, m, t0);
      return EXIT.failed;
    }
  } finally {
    await lock.release().catch(() => undefined);
  }
}

/** 시험용: 수집 잠금은 잡지 않는다 (함수 안 advisory lock이 예약 작업과 차례로 돌리고, 수집 INSERT와는 MVCC라 막히지 않음) */
async function aggregateCommand(pool: pg.Pool, logger: Logger, days: number): Promise<number> {
  const t0 = Date.now();
  const agg: WindowAggregate = await aggregateWindowOnPool(
    pool,
    { days, statementTimeout: RIOT_CLIENT_CONFIG.aggregateStatementTimeout },
    logger,
  );
  logger.info('요약 집계', {
    ok: agg.ok,
    elapsedMs: Date.now() - t0,
    analyzeMs: agg.analyzeMs,
    refreshMs: agg.refreshMs,
    ...(agg.result ? { result: JSON.stringify(agg.result) } : { warning: agg.warning }),
  });
  return agg.ok ? EXIT.ok : EXIT.failed;
}

async function purgeCommand(args: Args, pool: pg.Pool, logger: Logger, keepDays: number): Promise<number> {
  const p = await planPurgeGames(pool, keepDays);
  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  logger.info('purge 미리보기', {
    keepDays,
    totalGames: p.total,
    removeGames: p.remove,
    oldestStartAt: iso(p.oldestStartAt),
    newestStartAt: iso(p.newestStartAt),
    newestRemoveStartAt: iso(p.newestRemoveStartAt),
  });
  if (!args.yes) {
    logger.info(`미리보기만 했습니다. 실제로 지우려면 --yes를 붙이세요 (purge_old_games(${keepDays}), 되돌릴 수 없음).`);
    return EXIT.ok;
  }
  const lock = await CollectorLock.acquire(pool);
  try {
    const r = await pool.query<{ n: number }>('SELECT purge_old_games($1)::int AS n', [keepDays]);
    logger.info('purge 끝', { deletedMatches: r.rows[0]?.n ?? 0 });
    return EXIT.ok;
  } finally {
    await lock.release().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  const logger = createLogger('collect');
  let args: Args;
  try {
    args = parseCli(process.argv.slice(2));
  } catch (err) {
    console.error(formatError(err));
    console.error(USAGE);
    return EXIT.failed;
  }
  if (!['run', 'sample', 'matches', 'aggregate', 'purge'].includes(args.command)) {
    console.log(USAGE);
    return args.command === 'help' ? EXIT.ok : EXIT.failed;
  }

  let pool: pg.Pool | null = null;
  const stop = { requested: false };
  let sigints = 0;
  process.on('SIGINT', () => {
    sigints++;
    if (sigints === 1) {
      stop.requested = true;
      logger.warn('Ctrl+C: 지금 게임을 마친 뒤 멈춥니다. 한 번 더 누르면 바로 종료 (running 기록은 다음 실행이 닫음)');
    } else {
      process.exit(EXIT.aborted);
    }
  });

  try {
    const db = loadDbEnv();
    if (['run', 'sample', 'matches'].includes(args.command)) loadRiotEnv(); // 키가 없으면 바로 종료
    pool = createPool(db.databaseUrl, 2, logger);
    switch (args.command) {
      case 'aggregate':
        return await aggregateCommand(pool, logger, buildCollectionConfig(args.preset).windowDays);
      case 'purge':
        return await purgeCommand(args, pool, logger, buildCollectionConfig(args.preset).keepDays);
      default:
        return await collectCommand(args, pool, logger, stop);
    }
  } catch (err) {
    if (err instanceof CollectorLockedError) {
      logger.error(err.message);
      return EXIT.locked;
    }
    if (err instanceof EnvError || err instanceof ConfigError) {
      logger.error(err.message);
      return EXIT.failed;
    }
    logger.error('실패', { error: formatError(err) });
    return EXIT.failed;
  } finally {
    await pool?.end().catch(() => undefined);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(formatError(err));
    process.exitCode = EXIT.failed;
  },
);
