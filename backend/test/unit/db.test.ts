// withTransaction·readSnapshot: logger를 넘기면 빌린 연결의 'error' 이벤트를 로그로만 남긴다 (02-6, L5)
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { withTransaction } from '../../src/db/tx.js';
import { readSnapshot } from '../../src/db/snapshot.js';
import type { Logger } from '../../src/lib/logger.js';

/** pg.PoolClient를 흉내: BEGIN/COMMIT/ROLLBACK은 성공으로 치고, EventEmitter로 'error'를 낼 수 있게 한다 */
function fakeClient(): pg.PoolClient & EventEmitter {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    query: async (_sql: string) => ({ rows: [], rowCount: 0 }),
    release: () => undefined,
  }) as unknown as pg.PoolClient & EventEmitter;
}

function capturingLogger(): Logger & { errors: { msg: string; fields?: Record<string, unknown> }[] } {
  const errors: { msg: string; fields?: Record<string, unknown> }[] = [];
  return { errors, info: () => {}, warn: () => {}, error: (msg, fields) => errors.push({ msg, fields }) };
}

describe('withTransaction 연결 오류 리스너', () => {
  it('logger를 넘기면 빌린 연결의 error 이벤트가 로그로 남는다', async () => {
    const client = fakeClient();
    const pool = { connect: async () => client } as unknown as pg.Pool;
    const logger = capturingLogger();
    const result = await withTransaction(pool, async () => 'ok', logger);
    assert.equal(result, 'ok');
    client.emit('error', Object.assign(new Error('연결 끊김'), { code: 'ECONNRESET' }));
    assert.equal(logger.errors.length, 1);
    assert.ok(logger.errors[0]?.msg.includes('연결 오류'));
  });

  it('logger를 안 넘기면 리스너를 붙이지 않는다 (기존과 같음)', async () => {
    const client = fakeClient();
    const pool = { connect: async () => client } as unknown as pg.Pool;
    await withTransaction(pool, async () => 'ok');
    assert.equal(client.listenerCount('error'), 0);
  });
});

describe('readSnapshot 연결 오류 리스너', () => {
  it('logger를 넘기면 빌린 연결의 error 이벤트가 로그로 남는다', async () => {
    const client = fakeClient();
    const pool = { connect: async () => client } as unknown as pg.Pool;
    const logger = capturingLogger();
    const result = await readSnapshot(pool, async () => 'ok', logger);
    assert.equal(result, 'ok');
    client.emit('error', Object.assign(new Error('연결 끊김'), { code: 'ECONNRESET' }));
    assert.equal(logger.errors.length, 1);
    assert.ok(logger.errors[0]?.msg.includes('연결 오류'));
  });

  it('logger를 안 넘기면 리스너를 붙이지 않는다 (기존과 같음)', async () => {
    const client = fakeClient();
    const pool = { connect: async () => client } as unknown as pg.Pool;
    await readSnapshot(pool, async () => 'ok');
    assert.equal(client.listenerCount('error'), 0);
  });
});
