// ① 표본 플레이어 (back_spec 3-2 ①, 결정 D8: page 1에서 무작위, 시드 로그)
import { DIVISIONS, divisionQuota } from '../config/collection.js';
import { shortPuuid } from '../lib/logger.js';
import { RiotNotFoundError } from '../riot/errors.js';
import type { LeagueEntryDto } from '../riot/types.js';
import { countRankedPlayersByTier, upsertRankedPlayers, type SamplePlayer } from '../repositories/rawRepository.js';
import { UserAbortError, type CollectorContext } from './context.js';

/** 재현 가능한 의사 난수 (mulberry32) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 앞에서 n개를 무작위로 고른다 (Fisher-Yates 부분 섞기). 원본은 바꾸지 않는다 */
export function pickRandom<T>(items: readonly T[], n: number, rand: () => number): T[] {
  const a = [...items];
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a.slice(0, k);
}

/** 한 디비전 페이지에서 고를 수 있는 사람: 요청 티어·디비전과 같고 inactive가 아님 */
export function eligibleEntries(entries: LeagueEntryDto[], tier: string, division: string): LeagueEntryDto[] {
  return entries.filter(
    (e) =>
      e &&
      typeof e.puuid === 'string' &&
      e.puuid.length > 0 &&
      e.tier === tier &&
      e.rank === division &&
      e.inactive !== true,
  );
}

export interface SampleResult {
  seed: number;
  sampledTiers: string[];
  skippedTiers: string[];
  upserted: number;
  calls: number;
}

/**
 * 설정한 티어마다: 표본이 이미 playersPerTier명 이상이면 건너뛰고(--resample이면 다시 뽑음),
 * 아니면 디비전 I~IV page 1에서 무작위로 뽑아 upsert (더하기만, 삭제 없음)
 */
export async function runSample(
  ctx: CollectorContext,
  opts: { resample: boolean; seed?: number },
): Promise<SampleResult> {
  const { cfg, logger, riot, pool } = ctx;
  const seed = opts.seed ?? (Date.now() ^ (process.pid << 16)) >>> 0;
  const rand = seededRandom(seed);
  const existing = await countRankedPlayersByTier(pool, cfg.tiers);
  const quota = divisionQuota(cfg.playersPerTier);
  const out: SampleResult = { seed, sampledTiers: [], skippedTiers: [], upserted: 0, calls: 0 };
  logger.info('① 표본 시작', { seed, tiers: cfg.tiers.join(','), playersPerTier: cfg.playersPerTier, resample: opts.resample });

  for (const tier of cfg.tiers) {
    const have = existing.get(tier) ?? 0;
    if (!opts.resample && have >= cfg.playersPerTier) {
      logger.info('① 표본이 이미 있어 건너뜀', { tier, players: have });
      out.skippedTiers.push(tier);
      continue;
    }
    const rows: SamplePlayer[] = [];
    for (const division of DIVISIONS) {
      if (ctx.stop.requested) throw new UserAbortError();
      const n = quota[division];
      if (n === 0) continue;
      let entries: LeagueEntryDto[];
      try {
        out.calls++;
        entries = await riot.getLeagueEntries(tier, division, 1);
      } catch (err) {
        if (err instanceof RiotNotFoundError) {
          logger.warn('① 리그 페이지 없음, 건너뜀', { tier, division });
          continue;
        }
        throw err;
      }
      const pool205 = eligibleEntries(entries, tier, division);
      const picked = pickRandom(pool205, n, rand);
      if (picked.length < n) logger.warn('① 고를 사람이 모자람', { tier, division, want: n, got: picked.length });
      for (const e of picked) rows.push({ puuid: e.puuid, tier, rank: division });
      logger.info('① 디비전', {
        tier,
        division,
        page: entries.length,
        eligible: pool205.length,
        picked: picked.length,
        first: picked[0] ? shortPuuid(picked[0].puuid) : null,
      });
    }
    out.upserted += await upsertRankedPlayers(pool, rows);
    out.sampledTiers.push(tier);
  }
  logger.info('① 표본 끝', { seed, upserted: out.upserted, sampled: out.sampledTiers.join(',') || '-', skipped: out.skippedTiers.join(',') || '-' });
  return out;
}
