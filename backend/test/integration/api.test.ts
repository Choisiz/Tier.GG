// API v2: createApp(롤백 ApiDb) → listen(0) + fetch → ROLLBACK (실제 Supabase)
// 2021년 가짜 게임 60개(0.8 24개, 0.9 36개) → 과거 p_until로 창 집계 → 고정 시계로 응답 확인 (변경 01-7-3)
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import { createApp, type ApiDb } from '../../src/api/app.js';
import { aggregateWindow } from '../../src/collector/aggregate.js';
import { silentLogger } from '../../src/lib/logger.js';
import { saveMatch } from '../../src/repositories/rawRepository.js';
import { connect, FAKE_UNTIL, fakeGames, insertSamplePlayer } from '../helpers/db.js';

const OLD = 24; // 0.8
const NEW = 36; // 0.9
const GAMES = OLD + NEW; // 챔피언 × 포지션 pick 60 ≥ 50 → tier가 null이 아님
let client: pg.Client;
let server: Server;
let base: string;
let aggregatedAt: Date;
/** 고정 시계: 집계 시각 + 1시간 (isStale false) */
let nowMs: number;

async function get(path: string) {
  const r = await fetch(base + path);
  return { status: r.status, cache: r.headers.get('cache-control'), type: r.headers.get('content-type'), body: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

before(async () => {
  client = connect();
  await client.connect();
  await client.query('BEGIN');
  await insertSamplePlayer(client);
  for (const g of fakeGames(OLD, { patch: '0.8', firstId: 1 })) await saveMatch(client, g.match, g.players);
  for (const g of fakeGames(NEW, { patch: '0.9', firstId: OLD + 1 })) await saveMatch(client, g.match, g.players);
  const agg = await aggregateWindow(client, { days: 14, until: FAKE_UNTIL }, silentLogger);
  assert.equal(agg.ok, true);
  aggregatedAt = (await client.query(`SELECT aggregated_at FROM stats_window`)).rows[0].aggregated_at;
  nowMs = aggregatedAt.getTime() + 3_600_000;
  // 롤백 연결은 이미 트랜잭션 안이라 snapshot은 fn(client) 그대로
  const db: ApiDb = {
    query: (text, values) => client.query(text, values),
    snapshot: (fn) => fn(client),
  };
  server = createApp(db, silentLogger, { now: () => nowMs }).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

after(async () => {
  server.closeAllConnections();
  server.close();
  await client.query('ROLLBACK');
  await client.end();
  // 정리 확인
  const c = connect();
  await c.connect();
  try {
    const r = await c.query(
      `SELECT (SELECT count(*)::int FROM matches WHERE match_id LIKE 'KR\\_9000000%')
            + (SELECT count(*)::int FROM stats_window_patch WHERE patch IN ('0.8', '0.9'))
            + (SELECT count(*)::int FROM ranked_players WHERE puuid LIKE 'TEST\\_%') AS n`,
    );
    assert.equal(r.rows[0].n, 0);
  } finally {
    await c.end();
  }
});

const expectedWindow = (isStale = false) => ({
  days: 14,
  start: '2021-01-01T00:00:00.000Z',
  end: '2021-01-15T00:00:00.000Z',
  games: GAMES,
  aggregatedAt: aggregatedAt.toISOString(),
  isStale,
  patches: [
    { patch: '0.9', displayName: '10.9', games: NEW, share: 60 },
    { patch: '0.8', displayName: '10.8', games: OLD, share: 40 },
  ],
});

describe('API v2 (ROLLBACK 연결)', () => {
  it('GET /health: stats.state fresh', async () => {
    const r = await get('/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'ok', db: 'ok', stats: { state: 'fresh', aggregatedAt: aggregatedAt.toISOString() } });
    assert.equal(r.cache, 'no-store');
  });

  it('GET /meta: window 형식, 패치 최신 순·displayName·share, 캐시 헤더', async () => {
    const r = await get('/meta');
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'public, max-age=600');
    assert.equal(r.type, 'application/json; charset=utf-8');
    const b = r.body;
    assert.deepEqual(Object.keys(b).sort(), ['lastCollectedAt', 'positions', 'rules', 'window']);
    assert.deepEqual(b.window, expectedWindow());
    assert.deepEqual(b.positions, ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
    assert.deepEqual(b.rules, { minTierPick: 50, secondaryPositionMinShare: 10, windowDays: 14, staleAfterHours: 26 });
    assert.ok(b.lastCollectedAt === null || !Number.isNaN(Date.parse(b.lastCollectedAt)));
  });

  it('GET /champions?position=TOP: 형식·정렬·주 포지션', async () => {
    const r = await get('/champions?position=TOP');
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'public, max-age=600');
    assert.deepEqual(Object.keys(r.body).sort(), ['champions', 'position', 'window']);
    assert.deepEqual(r.body.window, expectedWindow());
    assert.equal(r.body.position, 'TOP');
    const list = r.body.champions as Record<string, unknown>[];
    assert.equal(list.length, 2); // 각 팀 탑 1명씩 (트린다미어 23 + 상대 탑)
    const c = list.find((x) => x.championId === 23)!;
    assert.deepEqual(Object.keys(c).sort(), ['ban', 'banRate', 'championId', 'mainPositions', 'pick', 'pickRate', 'positionShare', 'rank', 'tier', 'tierScore', 'win', 'winRate'].sort());
    assert.equal(c.pick, GAMES);
    assert.equal(c.win, GAMES / 2);
    assert.equal(c.winRate, 50);
    assert.equal(c.pickRate, 100);
    assert.equal(c.positionShare, 100);
    assert.deepEqual(c.mainPositions, ['TOP']);
    assert.ok(typeof c.tier === 'number' && c.tier >= 1 && c.tier <= 5);
    assert.equal(typeof c.tierScore, 'number');
    // 정렬: tier 오름차순 → tierScore 내림차순 → championId, rank 1부터
    list.forEach((x, i) => assert.equal(x.rank, i + 1));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1] as { tier: number; tierScore: number; championId: number };
      const b = list[i] as { tier: number; tierScore: number; championId: number };
      assert.ok(a.tier < b.tier || (a.tier === b.tier && (a.tierScore > b.tierScore || (a.tierScore === b.tierScore && a.championId < b.championId))));
    }
  });

  it('옛 patch 쿼리는 무시 (같은 응답)', async () => {
    const a = await get('/champions?position=TOP');
    const b = await get('/champions?position=TOP&patch=16.19');
    assert.equal(b.status, 200);
    assert.deepEqual(b.body, a.body);
  });

  it('GET /champions/23: 상세 형식 (위치 생략 → 1순위)', async () => {
    const r = await get('/champions/23');
    assert.equal(r.status, 200);
    const b = r.body;
    assert.deepEqual(Object.keys(b).sort(), ['builds', 'championId', 'isMainPosition', 'position', 'positions', 'stats', 'window'].sort());
    assert.deepEqual(b.window, expectedWindow());
    assert.equal(b.championId, 23);
    assert.equal(b.position, 'TOP');
    assert.equal(b.isMainPosition, true);
    assert.deepEqual(b.positions.map((p: { position: string }) => p.position), ['TOP']);
    assert.deepEqual(Object.keys(b.positions[0]).sort(), ['pick', 'pickRate', 'position', 'positionShare', 'tier', 'tierScore', 'winRate']);
    assert.deepEqual(Object.keys(b.stats).sort(), ['ban', 'banRate', 'pick', 'pickRate', 'tier', 'tierScore', 'win', 'winRate']);
    assert.equal(b.stats.ban, 0);

    // 아이템: 모두, pick 내림차순. 1036 두 개는 한 번만 셈
    const items = b.builds.items as { itemId: number; pick: number; win: number; winRate: number; pickRate: number }[];
    assert.deepEqual(items.map((i) => i.itemId).sort((x, y) => x - y), [1018, 1036, 3006, 3046, 3074]);
    for (const i of items) assert.deepEqual(i, { itemId: i.itemId, pick: GAMES, win: GAMES / 2, winRate: 50, pickRate: 100 });

    assert.equal(b.builds.runes.length, 1);
    assert.deepEqual(b.builds.runes[0], {
      primaryStyle: 8100,
      primaryPerks: [9923, 8143, 8140, 8135],
      subStyle: 8000,
      subPerks: [8299, 9104],
      statPerks: { offense: 5008, flex: 5008, defense: 5011 },
      pick: GAMES,
      win: GAMES / 2,
      winRate: 50,
      pickRate: 100,
    });
    assert.deepEqual(b.builds.spells, [{ spellIds: [4, 14], pick: GAMES, win: GAMES / 2, winRate: 50, pickRate: 100 }]);
    assert.deepEqual(b.builds.skills, [{ skillOrder: 'EQQWQRQEQER', pick: GAMES, win: GAMES / 2, winRate: 50, pickRate: 100 }]);
  });

  it('밴만 된 챔피언(64) → 404 STATS_NOT_FOUND, details에 patch 없음', async () => {
    // 64는 이 게임에서 밴만 됐고 픽이 없어 champion 줄이 없다 (계약 9-2 한계)
    const r = await get('/champions/64');
    assert.equal(r.status, 404);
    assert.equal(r.cache, 'no-store');
    assert.equal(r.body.error.code, 'STATS_NOT_FOUND');
    assert.deepEqual(r.body.error.details, { championId: 64 });
  });

  it('포지션 통계가 없으면 404 STATS_NOT_FOUND (details.championId, position)', async () => {
    const r = await get('/champions/23?position=JUNGLE');
    assert.equal(r.status, 404);
    assert.deepEqual(r.body.error, {
      code: 'STATS_NOT_FOUND',
      message: '최근 14일 통계에 이 챔피언의 해당 포지션 통계가 없습니다.',
      details: { championId: 23, position: 'JUNGLE' },
    });
  });

  it('오래됨: aggregated_at = now() − 27시간 → window.isStale true, /health stats.state stale', async () => {
    await client.query('SAVEPOINT stale');
    try {
      await client.query(`UPDATE stats_window SET aggregated_at = now() - interval '27 hours'`);
      const at = (await client.query(`SELECT aggregated_at FROM stats_window`)).rows[0].aggregated_at as Date;
      const meta = await get('/meta');
      assert.equal(meta.body.window.isStale, true);
      assert.equal(meta.body.window.aggregatedAt, at.toISOString());
      const list = await get('/champions?position=TOP');
      assert.equal(list.body.window.isStale, true);
      const h = await get('/health');
      assert.equal(h.status, 200);
      assert.deepEqual(h.body.stats, { state: 'stale', aggregatedAt: at.toISOString() });
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT stale');
    }
  });
});
