// 진입점 2: 수집 CLI
// npm run collect -- <run|sample|matches|aggregate|purge> [옵션]
// 종료 코드: 0 정상, 1 실패, 2 키 만료(401/403), 3 다른 수집이 실행 중, 130 사용자 중단(Ctrl+C)
import { parseArgs } from 'node:util';
import type pg from 'pg';
import {
  buildCollectionConfig,
  ConfigError,
  RIOT_CLIENT_CONFIG,
  type CollectionConfig,
} from '../config/collection.js';
import { EnvError, loadDbEnv, loadRiotEnv } from '../config/env.js';
import { createPool, isDbConnectionError } from '../db/pool.js';
import { createLogger, formatError, type Logger } from '../lib/logger.js';
import { RiotClient } from '../riot/client.js';
import { RiotKeyExpiredError } from '../riot/errors.js';
import { RateLimiter } from '../riot/rateLimiter.js';
import { distinctMatchPatches } from '../repositories/rawRepository.js';
import { aggregatePatches, planPurge, type AggregateResult } from '../collector/aggregate.js';
import { TooManyFailuresError, UserAbortError, type CollectorContext } from '../collector/context.js';
import { createMatchesResult, runMatches, type MatchesResult } from '../collector/matches.js';
import { CollectorLock, CollectorLockedError, RunLog } from '../collector/runLog.js';
import { runSample } from '../collector/sample.js';
import { countRankedPlayersByTier } from '../repositories/rawRepository.js';
import { parsePatchParam } from '../api/validate.js';

const USAGE = `사용법: npm run collect -- <명령> [옵션]
  run        ①~⑥ 표본(없으면) → 게임 수집 → ANALYZE + 집계
  sample     ① 표본만 (--resample: 이미 있어도 다시 뽑아 더함)
  matches    ②~⑤ 저장된 표본으로 게임만 수집 (집계 없음)
  aggregate  ⑥ ANALYZE + 집계만 (--patch 16.19, 없으면 matches의 모든 패치)
  purge      ⑦ 오래된 원본 삭제 미리보기 (--yes를 붙여야 실제로 삭제)
옵션: --preset test|main  --max-matches N  --players-per-tier N  --games-per-player N
      --tiers PLATINUM,EMERALD,DIAMOND  --seed N  --resample  --patch X  --yes`;

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
  patch?: string;
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
      patch: { type: 'string' },
      yes: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const command = positionals[0] ?? (values.help ? 'help' : '');
  let patch: string | undefined;
  if (values.patch !== undefined) {
    const p = parsePatchParam(values.patch);
    if (!p.ok) throw new ConfigError(`--patch 형식이 아닙니다 (예: 16.19): ${values.patch}`);
    patch = p.value ?? undefined;
  }
  return {
    command,
    preset: values.preset ?? 'test',
    maxMatches: intOpt('--max-matches', values['max-matches']),
    playersPerTier: intOpt('--players-per-tier', values['players-per-tier']),
    gamesPerPlayer: intOpt('--games-per-player', values['games-per-player']),
    tiers: values.tiers?.split(','),
    seed: intOpt('--seed', values.seed),
    resample: values.resample ?? false,
    patch,
    yes: values.yes ?? false,
  };
}

function makeContext(pool: pg.Pool, cfg: CollectionConfig, logger: Logger, stop: { requested: boolean }): CollectorContext {
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
  return { pool, riot, cfg, riotCfg: RIOT_CLIENT_CONFIG, logger, stop };
}

function summarize(logger: Logger, ctx: CollectorContext | null, m: MatchesResult | null, agg: AggregateResult | null, t0: number) {
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
  if (agg) {
    logger.info('요약 집계', {
      analyzeMs: agg.analyzeMs,
      patches: JSON.stringify(agg.patches.map((p) => ({ patch: p.patch, ok: p.ok, ms: p.ms, ...(p.result ?? {}) }))),
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
  const ctx = makeContext(pool, cfg, logger, stop);
  logger.info('설정', {
    command: args.command,
    preset: cfg.preset,
    tiers: cfg.tiers.join(','),
    playersPerTier: cfg.playersPerTier,
    gamesPerPlayer: cfg.gamesPerPlayer,
    maxMatches: cfg.maxMatchesPerRun,
    limits: `${RIOT_CLIENT_CONFIG.perSecondLimit}/1s,${RIOT_CLIENT_CONFIG.perWindowLimit}/${RIOT_CLIENT_CONFIG.windowMs / 1000}s`,
  });
  const t0 = Date.now();
  const lock = await CollectorLock.acquire(pool);
  let log: RunLog | null = null;
  let m: MatchesResult | null = null;
  let agg: AggregateResult | null = null;
  try {
    log = await RunLog.start(pool, logger);
    try {
      if (args.command === 'sample') {
        await runSample(ctx, { resample: args.resample, seed: args.seed });
        const n = [...(await countRankedPlayersByTier(pool, cfg.tiers)).values()].reduce((a, b) => a + b, 0);
        await log.finish('done', n, 0, null);
        summarize(logger, ctx, null, null, t0);
        return EXIT.ok;
      }
      if (args.command === 'run') await runSample(ctx, { resample: args.resample, seed: args.seed });
      m = createMatchesResult();
      await runMatches(ctx, m);
      if (args.command === 'run') {
        if (m.saved === 0) {
          logger.info('⑥ 이번 실행에서 저장한 게임이 0개라 집계를 건너뜀');
        } else {
          agg = await aggregatePatches(pool, [...m.savedPatches], logger, RIOT_CLIENT_CONFIG.aggregateStatementTimeout);
        }
      }
      await log.finish('done', m.players, m.saved, null);
      summarize(logger, ctx, m, agg, t0);
      return EXIT.ok;
    } catch (err) {
      // runMatches가 중간에 던져도 m에 그때까지 저장한 수가 남아 있다
      const saved = m?.saved ?? 0;
      const players = m && m.players > 0 ? m.players : null;
      if (err instanceof RiotKeyExpiredError) {
        logger.error('Riot 키 만료(401/403). 수집을 멈추고 집계는 건너뜀. 키를 재발급해 .env에 넣고 같은 명령을 다시 실행하세요.', {
          status: err.status,
          path: err.path,
        });
        await log.finish('key_expired', players, saved, `Riot 키 만료 (HTTP ${err.status})`);
        summarize(logger, ctx, m, agg, t0);
        return EXIT.keyExpired;
      }
      if (err instanceof UserAbortError) {
        logger.warn('사용자 중단. 집계는 건너뜀');
        await log.finish('failed', players, saved, '사용자 중단');
        summarize(logger, ctx, m, agg, t0);
        return EXIT.aborted;
      }
      const msg = formatError(err);
      logger.error('수집 실패', { error: msg, kind: err instanceof TooManyFailuresError ? 'too_many_failures' : isDbConnectionError(err) ? 'db' : 'unexpected' });
      if (err instanceof Error && err.stack && !(err instanceof TooManyFailuresError)) logger.error(formatError(err.stack));
      await log.finish('failed', players, saved, msg).catch((e: unknown) => logger.error('collection_logs 기록 실패', { error: formatError(e) }));
      summarize(logger, ctx, m, agg, t0);
      return EXIT.failed;
    }
  } finally {
    await lock.release().catch(() => undefined);
  }
}

async function aggregateCommand(args: Args, pool: pg.Pool, logger: Logger): Promise<number> {
  const lock = await CollectorLock.acquire(pool);
  try {
    const patches = args.patch ? [args.patch] : await distinctMatchPatches(pool);
    if (patches.length === 0) {
      logger.warn('matches에 게임이 없어 집계할 패치가 없음');
      return EXIT.ok;
    }
    const t0 = Date.now();
    const agg = await aggregatePatches(pool, patches, logger, RIOT_CLIENT_CONFIG.aggregateStatementTimeout);
    summarize(logger, null, null, agg, t0);
    return agg.patches.every((p) => p.ok) ? EXIT.ok : EXIT.failed;
  } finally {
    await lock.release().catch(() => undefined);
  }
}

async function purgeCommand(args: Args, pool: pg.Pool, logger: Logger, keep: number): Promise<number> {
  const lock = await CollectorLock.acquire(pool);
  try {
    const plan = await planPurge(pool, keep);
    logger.info('⑦ 패치별 게임 수', { perPatch: JSON.stringify(plan.perPatch), keep: plan.keep.join(',') || '-' });
    const total = plan.remove.reduce((a, p) => a + p.games, 0);
    logger.info('⑦ 지울 원본', { patches: plan.remove.map((p) => p.patch).join(',') || '-', games: total });
    if (!args.yes) {
      logger.info('미리보기만 했습니다. 실제로 지우려면 --yes를 붙이세요 (되돌릴 수 없음).');
      return EXIT.ok;
    }
    if (plan.remove.length === 0) {
      logger.info('지울 원본이 없습니다.');
      return EXIT.ok;
    }
    if (plan.notAggregated.length > 0) {
      logger.error(`집계되지 않은 패치가 있어 거부합니다. 먼저 aggregate --patch ${plan.notAggregated[0]}`, {
        patches: plan.notAggregated.join(','),
      });
      return EXIT.failed;
    }
    const r = await pool.query<{ n: number }>('SELECT purge_old_patches($1)::int AS n', [keep]);
    logger.info('⑦ 삭제 끝', { deletedMatches: r.rows[0]?.n ?? 0 });
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
        return await aggregateCommand(args, pool, logger);
      case 'purge':
        return await purgeCommand(args, pool, logger, buildCollectionConfig(args.preset).keepPatches);
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
