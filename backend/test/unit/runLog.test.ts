// CollectorLock: 잠금 연결이 끊겨도 프로세스가 죽지 않고 lost로 알린다 (Review 수정, back_review R-M1)
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import type pg from 'pg';
import { CollectorLock, CollectorLockedError } from '../../src/collector/runLog.js';

function fakePool(lockOk: boolean) {
  const client = new EventEmitter() as EventEmitter & {
    queries: string[];
    released: unknown[];
    query: (sql: string) => Promise<{ rows: { ok: boolean }[] }>;
    release: (err?: unknown) => void;
  };
  client.queries = [];
  client.released = [];
  client.query = async (sql: string) => {
    client.queries.push(sql);
    return { rows: [{ ok: lockOk }] };
  };
  client.release = (err?: unknown) => {
    client.released.push(err ?? 'ok');
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  return { pool, client };
}

describe('CollectorLock', () => {
  it('잠금 연결의 error 이벤트 → 처리되지 않은 오류로 죽지 않고 lost = true, onLost 1번', async () => {
    const { pool, client } = fakePool(true);
    const seen: Error[] = [];
    const lock = await CollectorLock.acquire(pool, (e) => seen.push(e));
    assert.equal(lock.lost, false);
    const err = new Error('terminating connection due to administrator command');
    assert.doesNotThrow(() => client.emit('error', err));
    client.emit('error', new Error('두 번째'));
    assert.equal(lock.lost, true);
    assert.deepEqual(seen, [err]);
  });

  it('잃은 잠금의 release: unlock 쿼리 없이 연결을 오류와 함께 버린다', async () => {
    const { pool, client } = fakePool(true);
    const lock = await CollectorLock.acquire(pool);
    const err = new Error('gone');
    client.emit('error', err);
    await lock.release();
    assert.ok(!client.queries.some((q) => q.includes('pg_advisory_unlock')));
    assert.deepEqual(client.released, [err]);
  });

  it('정상 release: unlock 후 풀에 돌려준다', async () => {
    const { pool, client } = fakePool(true);
    const lock = await CollectorLock.acquire(pool);
    await lock.release();
    assert.ok(client.queries.some((q) => q.includes('pg_advisory_unlock')));
    assert.deepEqual(client.released, ['ok']);
  });

  it('잠금을 못 잡으면 CollectorLockedError, 연결은 돌려준다', async () => {
    const { pool, client } = fakePool(false);
    await assert.rejects(CollectorLock.acquire(pool), CollectorLockedError);
    assert.deepEqual(client.released, ['ok']);
  });
});
