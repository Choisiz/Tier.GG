// 트랜잭션 도우미와 Queryable 타입
// 저장소 함수는 Queryable(풀 또는 연결)을 인자로 받아, 테스트에서 BEGIN … ROLLBACK 연결을 넣을 수 있다.
import type pg from 'pg';

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

/** 연결을 하나 빌려 BEGIN → fn → COMMIT, 예외면 ROLLBACK */
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await inTransaction(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** 이미 가진 연결에서 BEGIN → fn → COMMIT, 예외면 ROLLBACK */
export async function inTransaction<T>(client: Queryable, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 연결이 끊긴 경우 등: 원래 오류를 던진다
    }
    throw err;
  }
}
