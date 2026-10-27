// API: 가짜 ApiDb로 createApp → listen(0) + fetch (DB 없음). 오류 경로, 집계 전 503, 스냅숏 1번, patch 무시
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp, type ApiDb } from '../../src/api/app.js';
import type { SummonerSearchFn } from '../../src/api/summonerSearch.js';
import type { Queryable } from '../../src/db/tx.js';
import { silentLogger, type Logger } from '../../src/lib/logger.js';

/** 호출을 기록만 하는 가짜 로거 (02-5, L4) */
function capturingLogger(): Logger & { errors: { msg: string; fields?: Record<string, unknown> }[] } {
  const errors: { msg: string; fields?: Record<string, unknown> }[] = [];
  return {
    errors,
    info: () => {},
    warn: () => {},
    error: (msg, fields) => errors.push({ msg, fields }),
  };
}

type Handler = (sql: string, values?: unknown[]) => unknown[] | Error;

interface FakeDb extends ApiDb {
  snapshots: number;
  inside: string[];
  outside: string[];
}

function fakeDb(handler: Handler): FakeDb {
  const run = async (sql: string, log: string[], values?: unknown[]) => {
    log.push(sql);
    const out = handler(sql, values);
    if (out instanceof Error) throw out;
    return { rows: out, rowCount: out.length, command: 'SELECT', oid: 0, fields: [] } as never;
  };
  const db: FakeDb = {
    snapshots: 0,
    inside: [],
    outside: [],
    query: (sql: string, values?: unknown[]) => run(sql, db.outside, values),
    async snapshot<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      db.snapshots++;
      return fn({ query: (sql: string, values?: unknown[]) => run(sql, db.inside, values) });
    },
  };
  return db;
}

const AGG_AT = new Date('2026-10-14T20:00:00.418Z');
const NOW = AGG_AT.getTime() + 3_600_000;

/** 집계가 있는 가짜 DB: 챔피언 23 TOP 1줄 */
function fullHandler(sql: string, values?: unknown[]): unknown[] {
  if (sql.includes('FROM stats_window w')) {
    return [
      {
        days: 14,
        windowStart: new Date('2026-09-30T20:00:00.418Z'),
        windowEnd: AGG_AT,
        games: 60,
        aggregatedAt: AGG_AT,
        patches: [
          { patch: '0.9', games: 36 },
          { patch: '0.8', games: 24 },
        ],
      },
    ];
  }
  if (sql.includes('FROM champion_tier_view')) {
    if (values?.[0] === 64) return [];
    return [
      { championId: 23, position: 'TOP', pick: 60, win: 30, ban: 0, winRate: 50, pickRate: 100, banRate: 0, tierScore: 60, tier: 1, positionShare: 100 },
    ];
  }
  if (sql.includes('FROM collection_logs')) return [{ t: null }];
  return [];
}

async function serve(db: ApiDb, logger: Logger = silentLogger): Promise<{ base: string; server: Server }> {
  const server = createApp(db, logger, { now: () => NOW }).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`, server };
}

const close = (s: { server: Server }) => {
  s.server.closeAllConnections();
  s.server.close();
};

describe('API (가짜 ApiDb)', () => {
  let empty: { base: string; server: Server };
  let emptyDb: FakeDb;
  let down: { base: string; server: Server };
  let broken: { base: string; server: Server };

  before(async () => {
    // 집계 전: stats_window 0줄, health는 aggregated_at null
    emptyDb = fakeDb((sql) => (sql.includes('SELECT (SELECT aggregated_at') ? [{ aggregated_at: null }] : []));
    empty = await serve(emptyDb);
    const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    down = await serve(fakeDb(() => connErr));
    broken = await serve(fakeDb(() => new Error('relation "secret_internal_table" does not exist')));
  });
  after(() => {
    for (const s of [empty, down, broken]) close(s);
  });

  it('stats_window 없음 → /meta·/champions·상세 모두 503 STATS_NOT_READY, no-store, 메시지', async () => {
    for (const path of ['/meta', '/champions?position=TOP', '/champions/23']) {
      const r = await fetch(empty.base + path);
      assert.equal(r.status, 503, path);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await r.json(), {
        error: { code: 'STATS_NOT_READY', message: '아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다.' },
      });
    }
  });

  it('집계 전 /health → 200, stats.state = empty', async () => {
    const r = await fetch(empty.base + '/health');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { status: 'ok', db: 'ok', stats: { state: 'empty', aggregatedAt: null } });
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  it('잘못된 파라미터 → 400 INVALID_PARAMETER + details (position, championId만)', async () => {
    const cases: [string, string, unknown][] = [
      ['/champions', 'position', null],
      ['/champions?position=top', 'position', 'top'],
      ['/champions/Aatrox', 'championId', 'Aatrox'],
      ['/champions/23?position=MID', 'position', 'MID'],
    ];
    for (const [path, param, value] of cases) {
      const r = await fetch(empty.base + path);
      assert.equal(r.status, 400, path);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      const body = (await r.json()) as { error: { code: string; message: string; details: unknown } };
      assert.equal(body.error.code, 'INVALID_PARAMETER');
      assert.deepEqual(body.error.details, { param, value });
      assert.ok(body.error.message.length > 0);
    }
  });

  it('?patch=… 는 무시 (400 아님)', async () => {
    for (const path of ['/champions?position=TOP&patch=16', '/champions?position=TOP&patch=16.19', '/champions/23?patch=x']) {
      const r = await fetch(empty.base + path);
      assert.equal(r.status, 503, path); // 집계 전이라 503. 파라미터 오류(400)가 아님
    }
  });

  it('없는 경로·POST → 404 NOT_FOUND', async () => {
    for (const [path, method] of [
      ['/nope', 'GET'],
      ['/meta', 'POST'],
    ] as const) {
      const r = await fetch(empty.base + path, { method });
      assert.equal(r.status, 404);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'NOT_FOUND');
    }
  });

  it('DB 실패 → health·통계 모두 503 DB_UNAVAILABLE', async () => {
    for (const path of ['/health', '/meta', '/champions?position=TOP']) {
      const r = await fetch(down.base + path);
      assert.equal(r.status, 503, path);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'DB_UNAVAILABLE');
    }
  });

  it('/health DB 오류 → 503이지만 서버 로그에 원인이 남는다 (02-5, L4)', async () => {
    const logger = capturingLogger();
    const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    const s = await serve(fakeDb(() => connErr), logger);
    try {
      const r = await fetch(s.base + '/health');
      assert.equal(r.status, 503);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'DB_UNAVAILABLE');
      const hit = logger.errors.filter((e) => e.msg.includes('health'));
      assert.equal(hit.length, 1);
      assert.ok(String(hit[0]?.fields?.error).includes('ECONNREFUSED'));
    } finally {
      close(s);
    }
  });

  it('그 밖의 오류 → 500 INTERNAL_ERROR, 내부 내용 없음', async () => {
    const r = await fetch(broken.base + '/meta');
    assert.equal(r.status, 500);
    const text = await r.text();
    assert.ok(!text.includes('secret_internal_table'));
    assert.equal((JSON.parse(text) as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
  });
});

describe('API 스냅숏·window (가짜 ApiDb, 집계 있음)', () => {
  let s: { base: string; server: Server };
  let db: FakeDb;
  before(async () => {
    db = fakeDb(fullHandler);
    s = await serve(db);
  });
  after(() => close(s));

  for (const path of ['/meta', '/champions?position=TOP', '/champions/23', '/champions/23?position=TOP&patch=16.19']) {
    it(`${path}: snapshot 정확히 1번, 모든 쿼리가 그 안에서, 첫 쿼리는 stats_window`, async () => {
      db.snapshots = 0;
      db.inside.length = 0;
      db.outside.length = 0;
      const r = await fetch(s.base + path);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'public, max-age=600');
      assert.equal(db.snapshots, 1);
      assert.equal(db.outside.length, 0);
      assert.ok(db.inside[0]?.includes('FROM stats_window w'));
      const body = (await r.json()) as { window: Record<string, unknown> };
      assert.deepEqual(body.window, {
        days: 14,
        start: '2026-09-30T20:00:00.418Z',
        end: '2026-10-14T20:00:00.418Z',
        games: 60,
        aggregatedAt: '2026-10-14T20:00:00.418Z',
        isStale: false,
        patches: [
          { patch: '0.9', displayName: '10.9', games: 36, share: 60 },
          { patch: '0.8', displayName: '10.8', games: 24, share: 40 },
        ],
      });
    });
  }

  it('/health: 한 문장, snapshot 없음, stats.state fresh, CORS 헤더 없음', async () => {
    const hdb = fakeDb((sql) => (sql.includes('SELECT (SELECT aggregated_at') ? [{ aggregated_at: AGG_AT }] : []));
    const h = await serve(hdb);
    try {
      const r = await fetch(h.base + '/health');
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { status: 'ok', db: 'ok', stats: { state: 'fresh', aggregatedAt: AGG_AT.toISOString() } });
      assert.equal(hdb.snapshots, 0);
      assert.equal(hdb.outside.length, 1);
      assert.equal(r.headers.get('access-control-allow-origin'), null);
      assert.equal(r.headers.get('x-powered-by'), null);
    } finally {
      close(h);
    }
  });

  it('/meta 형식: rules에 windowDays·staleAfterHours, fallback 필드 없음', async () => {
    const r = await fetch(s.base + '/meta');
    const b = (await r.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(b).sort(), ['lastCollectedAt', 'positions', 'rules', 'window']);
    assert.deepEqual(b.rules, { minTierPick: 50, secondaryPositionMinShare: 10, windowDays: 14, staleAfterHours: 26 });
    assert.equal(b.lastCollectedAt, null);
  });

  it('없는 챔피언 → 404 STATS_NOT_FOUND, details에 patch 없음', async () => {
    const r = await fetch(s.base + '/champions/64');
    assert.equal(r.status, 404);
    assert.deepEqual(((await r.json()) as { error: { details: unknown } }).error.details, { championId: 64 });
  });
});

describe('GET /summoners/:region/:riotId (변경 03, 가짜 summonerSearch)', () => {
  async function serveSummoner(summonerSearch?: SummonerSearchFn): Promise<{ base: string; server: Server }> {
    const db = fakeDb(() => []);
    const app = createApp(db, silentLogger, { summonerSearch });
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`, server };
  }

  it('summonerSearch에 파싱된 region/gameName/tagLine을 넘기고, no-store로 응답', async () => {
    const calls: { region: string; gameName: string; tagLine: string }[] = [];
    const s = await serveSummoner(async (region, gameName, tagLine) => {
      calls.push({ region, gameName, tagLine });
      return { summoner: { puuid: 'P1', gameName, tagLine, profileIconId: 1, summonerLevel: 1 }, leagues: [], matches: [] };
    });
    try {
      const r = await fetch(`${s.base}/summoners/kr/${encodeURIComponent('너희는개다-KR1')}`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.deepEqual(calls, [{ region: 'kr', gameName: '너희는개다', tagLine: 'KR1' }]);
      const body = (await r.json()) as { summoner: { gameName: string; tagLine: string } };
      assert.equal(body.summoner.gameName, '너희는개다');
      assert.equal(body.summoner.tagLine, 'KR1');
    } finally {
      close(s);
    }
  });

  const stubDto = () => ({ summoner: { puuid: 'P1', gameName: 'x', tagLine: 'KR1', profileIconId: 1, summonerLevel: 1 }, leagues: [], matches: [] });

  it('region이 kr이 아니면 400 INVALID_PARAMETER (summonerSearch를 부르지 않음)', async () => {
    let called = false;
    const s = await serveSummoner(async () => {
      called = true;
      return stubDto();
    });
    try {
      const r = await fetch(`${s.base}/summoners/na/foo-KR1`);
      assert.equal(r.status, 400);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'INVALID_PARAMETER');
      assert.equal(called, false);
    } finally {
      close(s);
    }
  });

  it('riotId 형식 오류(태그 없음) → 400 INVALID_PARAMETER', async () => {
    const s = await serveSummoner(async () => stubDto());
    try {
      const r = await fetch(`${s.base}/summoners/kr/noDash`);
      assert.equal(r.status, 400);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'INVALID_PARAMETER');
    } finally {
      close(s);
    }
  });

  it('summonerSearch를 넘기지 않은 createApp에서는 500 INTERNAL_ERROR (기존 테스트가 깨지지 않음)', async () => {
    const s = await serveSummoner(undefined);
    try {
      const r = await fetch(`${s.base}/summoners/kr/foo-KR1`);
      assert.equal(r.status, 500);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
    } finally {
      close(s);
    }
  });
});
