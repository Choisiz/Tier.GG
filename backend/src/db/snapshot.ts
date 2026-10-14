// 한 요청 = 한 스냅숏 (back_spec 변경 01-6-4, db_review L11)
// 05:00 집계가 커밋되는 순간 stats_window(분모)와 champion(개수)이 섞이지 않게,
// 연결 1개에서 REPEATABLE READ READ ONLY 트랜잭션을 열고 그 안에서 모든 읽기를 차례로 한다.
// 스냅숏은 첫 문장에서 정해진다. 읽기 전용이라 직렬화 오류(40001)가 나지 않고 집계를 막지도 않는다.
import type pg from 'pg';
import type { Queryable } from './tx.js';

export async function readSnapshot<T>(pool: pg.Pool, fn: (q: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  // BEGIN·ROLLBACK이 실패한 연결은 상태를 알 수 없으므로 풀에 돌려주지 않고 버린다
  let discard = false;
  try {
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    } catch (err) {
      discard = true;
      throw err;
    }
    try {
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        discard = true;
      });
      throw err;
    }
  } finally {
    client.release(discard || undefined);
  }
}
