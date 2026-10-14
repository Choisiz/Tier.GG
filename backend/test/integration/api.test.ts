// API: createApp(트랜잭션 연결) → listen(0) + fetch → ROLLBACK (실제 Supabase)
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type pg from 'pg';
import { createApp } from '../../src/api/app.js';
import { aggregateOnConnection } from '../../src/collector/aggregate.js';
import { silentLogger } from '../../src/lib/logger.js';
import { saveMatch } from '../../src/repositories/rawRepository.js';
import { connect, fakeGames, insertSamplePlayer, TEST_PATCH } from '../helpers/db.js';

const GAMES = 60; // 챔피언 × 포지션 pick 60 ≥ 50 → tier가 null이 아님
let client: pg.Client;
let server: Server;
let base: string;

async function get(path: string) {
  const r = await fetch(base + path);
  return { status: r.status, cache: r.headers.get('cache-control'), type: r.headers.get('content-type'), body: (await r.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

before(async () => {
  client = connect();
  await client.connect();
  await client.query('BEGIN');
  await insertSamplePlayer(client);
  for (const g of fakeGames(GAMES)) await saveMatch(client, g.match, g.players);
  await aggregateOnConnection(client, [TEST_PATCH], silentLogger);
  server = createApp(client, silentLogger).listen(0);
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
    const r = await c.query(`SELECT (SELECT count(*)::int FROM matches WHERE patch = $1) + (SELECT count(*)::int FROM patch WHERE patch = $1) AS n`, [TEST_PATCH]);
    assert.equal(r.rows[0].n, 0);
  } finally {
    await c.end();
  }
});

describe('API (ROLLBACK 연결)', () => {
  it('GET /health', async () => {
    const r = await get('/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'ok', db: 'ok' });
    assert.equal(r.cache, 'no-store');
  });

  it('GET /meta: 형식, 0.9 포함, 캐시 헤더', async () => {
    const r = await get('/meta');
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'public, max-age=600');
    assert.equal(r.type, 'application/json; charset=utf-8');
    const b = r.body;
    assert.deepEqual(Object.keys(b).sort(), ['defaultPatch', 'isFallback', 'lastCollectedAt', 'latestPatch', 'patches', 'positions', 'rules']);
    assert.ok(b.patches.some((p: { patch: string; games: number }) => p.patch === TEST_PATCH && p.games === GAMES));
    assert.equal(typeof b.latestPatch, 'string');
    assert.equal(b.isFallback, b.defaultPatch !== b.latestPatch);
    assert.deepEqual(b.positions, ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);
    assert.deepEqual(b.rules, { minTierPick: 50, secondaryPositionMinShare: 10, fallbackMinGames: 5000 });
    assert.ok(b.lastCollectedAt === null || !Number.isNaN(Date.parse(b.lastCollectedAt)));
  });

  it('GET /champions?position=TOP&patch=0.9: 형식·정렬·주 포지션', async () => {
    const r = await get(`/champions?position=TOP&patch=${TEST_PATCH}`);
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'public, max-age=600');
    assert.deepEqual(r.body.patch, { data: TEST_PATCH, latest: r.body.patch.latest, requested: TEST_PATCH, isFallback: false, games: GAMES });
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

  it('GET /champions/23?patch=0.9: 상세 형식 (위치 생략 → 1순위)', async () => {
    const r = await get(`/champions/23?patch=${TEST_PATCH}`);
    assert.equal(r.status, 200);
    const b = r.body;
    assert.deepEqual(Object.keys(b).sort(), ['builds', 'championId', 'isMainPosition', 'patch', 'position', 'positions', 'stats'].sort());
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

  it('밴률: 64(1번 참가자 밴)는 모든 게임에서 밴', async () => {
    // 64는 이 게임에서 밴만 됐고 픽이 없어 champion 줄이 없다 (계약 9-2 한계) → 상세는 404
    const r = await get(`/champions/64?patch=${TEST_PATCH}`);
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'STATS_NOT_FOUND');
    assert.deepEqual(r.body.error.details, { championId: 64, patch: TEST_PATCH });
  });

  it('주 포지션이 아닌 포지션 통계가 없으면 404 STATS_NOT_FOUND (details.position)', async () => {
    const r = await get(`/champions/23?patch=${TEST_PATCH}&position=JUNGLE`);
    assert.equal(r.status, 404);
    assert.equal(r.cache, 'no-store');
    assert.deepEqual(r.body.error, {
      code: 'STATS_NOT_FOUND',
      message: r.body.error.message,
      details: { championId: 23, position: 'JUNGLE', patch: TEST_PATCH },
    });
  });

  it('없는 패치 → 404 PATCH_NOT_FOUND', async () => {
    const r = await get('/champions?position=TOP&patch=0.1');
    assert.equal(r.status, 404);
    assert.deepEqual(r.body.error.details, { patch: '0.1' });
    assert.equal(r.body.error.code, 'PATCH_NOT_FOUND');
  });
});
