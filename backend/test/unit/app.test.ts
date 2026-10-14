// API 오류 경로: 가짜 db로 createApp → listen(0) + fetch (DB 없음)
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { Server } from 'node:http';
import { createApp } from '../../src/api/app.js';
import type { Queryable } from '../../src/db/tx.js';
import { silentLogger } from '../../src/lib/logger.js';

type Handler = (sql: string) => unknown[] | Error;

function fakeDb(handler: Handler): Queryable {
  return {
    async query(sql: string) {
      const out = handler(sql);
      if (out instanceof Error) throw out;
      return { rows: out, rowCount: out.length, command: 'SELECT', oid: 0, fields: [] } as never;
    },
  };
}

async function serve(db: Queryable): Promise<{ base: string; server: Server }> {
  const server = createApp(db, silentLogger).listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`, server };
}

describe('API 오류 (가짜 db)', () => {
  let empty: { base: string; server: Server };
  let down: { base: string; server: Server };
  let broken: { base: string; server: Server };

  before(async () => {
    empty = await serve(fakeDb(() => [])); // 집계 패치 0개
    const connErr = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });
    down = await serve(fakeDb(() => connErr));
    broken = await serve(fakeDb(() => new Error('relation "secret_internal_table" does not exist')));
  });
  after(() => {
    for (const s of [empty, down, broken]) {
      s.server.closeAllConnections();
      s.server.close();
    }
  });

  it('집계된 패치 없음 → 503 STATS_NOT_READY, no-store', async () => {
    for (const path of ['/meta', '/champions?position=TOP', '/champions/23']) {
      const r = await fetch(empty.base + path);
      assert.equal(r.status, 503, path);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, 'STATS_NOT_READY');
    }
  });

  it('잘못된 파라미터 → 400 INVALID_PARAMETER + details (DB를 부르기 전에)', async () => {
    const cases: [string, string, unknown][] = [
      ['/champions', 'position', null],
      ['/champions?position=top', 'position', 'top'],
      ['/champions?position=TOP&patch=16', 'patch', '16'],
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

  it('health: DB 실패 → 503 DB_UNAVAILABLE, 통계 엔드포인트도 503', async () => {
    const h = await fetch(down.base + '/health');
    assert.equal(h.status, 503);
    assert.equal(((await h.json()) as { error: { code: string } }).error.code, 'DB_UNAVAILABLE');
    const m = await fetch(down.base + '/meta');
    assert.equal(m.status, 503);
    assert.equal(((await m.json()) as { error: { code: string } }).error.code, 'DB_UNAVAILABLE');
  });

  it('그 밖의 오류 → 500 INTERNAL_ERROR, 내부 내용 없음', async () => {
    const r = await fetch(broken.base + '/meta');
    assert.equal(r.status, 500);
    const text = await r.text();
    assert.ok(!text.includes('secret_internal_table'));
    assert.equal((JSON.parse(text) as { error: { code: string } }).error.code, 'INTERNAL_ERROR');
  });

  it('health 성공 → no-store, CORS 헤더 없음', async () => {
    const ok = await serve(fakeDb(() => [{ '?column?': 1 }]));
    try {
      const r = await fetch(ok.base + '/health');
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { status: 'ok', db: 'ok' });
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.headers.get('access-control-allow-origin'), null);
      assert.equal(r.headers.get('x-powered-by'), null);
    } finally {
      ok.server.closeAllConnections();
      ok.server.close();
    }
  });
});
