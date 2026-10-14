// runMatches: startTime 전달, 창 상한(window_full), 집계 호출 없음 (가짜 riot·가짜 저장, 변경 01-4)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { runMatches } from '../../src/collector/matches.js';
import type { CollectorContext } from '../../src/collector/context.js';
import { buildCollectionConfig, RIOT_CLIENT_CONFIG } from '../../src/config/collection.js';
import { silentLogger } from '../../src/lib/logger.js';
import type { RiotClient } from '../../src/riot/client.js';
import { clone, loadMatch, loadTimeline, OPTS } from '../helpers/fixture.js';

function setup(inWindow: number, ids: string[]) {
  const sqls: string[] = [];
  const result = (rows: unknown[], rowCount = rows.length) => ({ rows, rowCount });
  const query = async (sql: string) => {
    sqls.push(sql);
    if (/FROM matches WHERE game_start_at >=/.test(sql)) return result([{ n: inWindow }]);
    if (/FROM ranked_players/.test(sql)) return result([{ puuid: 'P_TEST_0001' }]);
    if (/SELECT match_id FROM matches/.test(sql)) return result([]);
    if (/INSERT INTO matches/.test(sql)) return result([], 1);
    if (/INSERT INTO match_players/.test(sql)) return result([], 10);
    return result([]);
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as pg.Pool;

  const calls = { ids: [] as unknown[], match: [] as string[], timeline: [] as string[] };
  const riot = {
    stats: { calls: 0 },
    async getMatchIds(_p: string, q: unknown) {
      calls.ids.push(q);
      return ids;
    },
    async getMatch(id: string) {
      calls.match.push(id);
      const m = clone(loadMatch());
      m.metadata.matchId = id;
      return m;
    },
    async getTimeline(id: string) {
      calls.timeline.push(id);
      const t = clone(loadTimeline());
      t.metadata.matchId = id;
      return t;
    },
  } as unknown as RiotClient;

  const ctx: CollectorContext = {
    pool,
    riot,
    cfg: buildCollectionConfig('test', { tiers: ['EMERALD'] }),
    riotCfg: RIOT_CLIENT_CONFIG,
    logger: silentLogger,
    window: { startMs: OPTS.windowStartMs, startTimeSec: Math.floor(OPTS.windowStartMs / 1000) },
    stop: { requested: false },
  };
  return { ctx, calls, sqls };
}

describe('runMatches (가짜 riot·저장)', () => {
  it('창 안 24,999 + 이번 1개 저장 → 다음 게임 전에 window_full, getMatch를 더 부르지 않음', async () => {
    const { ctx, calls } = setup(24_999, ['KR_3', 'KR_2', 'KR_1']);
    const r = await runMatches(ctx);
    assert.equal(r.saved, 1);
    assert.equal(r.stoppedBy, 'window_full');
    assert.deepEqual(calls.match, ['KR_3']);
    assert.equal(r.inWindowBefore, 24_999);
  });

  it('이미 25,000이면 ③을 한 번도 부르지 않음', async () => {
    const { ctx, calls } = setup(25_000, ['KR_1']);
    const r = await runMatches(ctx);
    assert.equal(r.stoppedBy, 'window_full');
    assert.equal(calls.match.length, 0);
  });

  it('② startTime = 창 시작(초)를 모든 플레이어에, 집계 함수는 부르지 않음', async () => {
    const { ctx, calls, sqls } = setup(0, ['KR_2', 'KR_1']);
    const r = await runMatches(ctx);
    assert.equal(r.saved, 2);
    assert.equal(r.stoppedBy, 'done');
    assert.deepEqual(calls.ids, [{ queue: 420, start: 0, count: 20, startTime: 1790726400 }]);
    assert.ok(!sqls.some((s) => /refresh_window_stats|ANALYZE|purge_old_games/.test(s)));
    const ins = sqls.find((s) => s.includes('INSERT INTO matches'));
    assert.ok(ins?.includes('game_start_at'));
  });

  it('창 밖 게임 → out_of_window, 타임라인을 부르지 않음', async () => {
    const { ctx, calls } = setup(0, ['KR_1']);
    ctx.window = { startMs: Date.parse('2026-10-07T00:00:00Z'), startTimeSec: 1791331200 };
    const r = await runMatches(ctx);
    assert.equal(r.skipped.out_of_window, 1);
    assert.equal(r.saved, 0);
    assert.equal(calls.timeline.length, 0);
  });
});
