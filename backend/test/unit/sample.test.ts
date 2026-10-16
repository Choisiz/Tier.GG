// runSample: 표본 보충은 모자란 만큼만 더하고, --resample이면 전체를 다시 뽑는다 (02-2, L1)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { runSample } from '../../src/collector/sample.js';
import type { CollectorContext } from '../../src/collector/context.js';
import { buildCollectionConfig, RIOT_CLIENT_CONFIG } from '../../src/config/collection.js';
import { silentLogger } from '../../src/lib/logger.js';
import type { RiotClient } from '../../src/riot/client.js';

/** 디비전마다 205명(요청 티어·디비전, inactive 아님)인 가짜 리그 페이지 */
function makeEntries(tier: string, division: string, n = 205) {
  return Array.from({ length: n }, (_, i) => ({ puuid: `P_${tier}_${division}_${i}`, tier, rank: division }));
}

function setup(existingByTier: Record<string, number>, playersPerTier: number) {
  const upserted: { puuid: string; tier: string; rank: string }[] = [];
  const query = async (sql: string, values?: unknown[]) => {
    if (/FROM ranked_players WHERE tier/.test(sql)) {
      const tiers = (values?.[0] as string[]) ?? [];
      const rows = tiers.filter((t) => (existingByTier[t] ?? 0) > 0).map((t) => ({ tier: t, n: existingByTier[t] }));
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO ranked_players/.test(sql)) {
      const [puuids, tiers, ranks] = values as [string[], string[], string[]];
      for (let i = 0; i < puuids.length; i++) {
        upserted.push({ puuid: puuids[i] as string, tier: tiers[i] as string, rank: ranks[i] as string });
      }
      return { rows: [], rowCount: puuids.length };
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query } as unknown as pg.Pool;
  const riot = {
    async getLeagueEntries(tier: string, division: string) {
      return makeEntries(tier, division);
    },
  } as unknown as RiotClient;
  const ctx: CollectorContext = {
    pool,
    riot,
    cfg: buildCollectionConfig('test', { tiers: ['EMERALD'], playersPerTier }),
    riotCfg: RIOT_CLIENT_CONFIG,
    logger: silentLogger,
    window: { startMs: 0, startTimeSec: 0 },
    stop: { requested: false },
  };
  return { ctx, upserted };
}

describe('runSample (가짜 riot·pool)', () => {
  it('have=180, playersPerTier=250 → 모자란 70명만 더 뽑는다 (--resample 아님)', async () => {
    const { ctx, upserted } = setup({ EMERALD: 180 }, 250);
    const r = await runSample(ctx, { resample: false, seed: 42 });
    assert.equal(r.upserted, 70);
    assert.equal(upserted.length, 70);
    assert.ok(upserted.every((x) => x.tier === 'EMERALD'));
  });

  it('have=0 → playersPerTier명 전체를 뽑는다 (기존 동작 유지)', async () => {
    const { ctx, upserted } = setup({}, 250);
    const r = await runSample(ctx, { resample: false, seed: 42 });
    assert.equal(r.upserted, 250);
    assert.equal(upserted.length, 250);
  });

  it('이미 playersPerTier명 이상이면 건너뜀 (--resample 아니면)', async () => {
    const { ctx, upserted } = setup({ EMERALD: 250 }, 250);
    const r = await runSample(ctx, { resample: false, seed: 42 });
    assert.equal(r.upserted, 0);
    assert.deepEqual(r.skippedTiers, ['EMERALD']);
    assert.equal(upserted.length, 0);
  });

  it('--resample이면 이미 충분해도 playersPerTier명 전체를 다시 뽑아 더한다', async () => {
    const { ctx, upserted } = setup({ EMERALD: 250 }, 250);
    const r = await runSample(ctx, { resample: true, seed: 42 });
    assert.equal(r.upserted, 250);
    assert.equal(upserted.length, 250);
    assert.deepEqual(r.skippedTiers, []);
  });
});
