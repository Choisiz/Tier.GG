// collection_logs: 수집 실행 1회 = 1줄
import type { Queryable } from '../db/tx.js';

export type RunStatus = 'running' | 'done' | 'key_expired' | 'failed';

/** 남아 있는 running 기록을 failed로 닫는다 (수집 잠금을 잡은 뒤에만 부른다). 닫은 줄 수 */
export async function closeStaleRunning(db: Queryable): Promise<number> {
  const r = await db.query(
    `UPDATE collection_logs
        SET status = 'failed', finished_at = greatest(now(), started_at), error_message = '비정상 종료로 남은 기록'
      WHERE status = 'running'`,
  );
  return r.rowCount ?? 0;
}

export async function startRun(db: Queryable): Promise<number> {
  // bigint는 pg가 문자열로 주므로 숫자로 바꾼다 (실행 횟수라 안전한 정수 범위)
  const r = await db.query<{ id: string }>(`INSERT INTO collection_logs (status) VALUES ('running') RETURNING id`);
  return Number((r.rows[0] as { id: string }).id);
}

export async function finishRun(
  db: Queryable,
  id: number,
  f: { status: Exclude<RunStatus, 'running'>; players: number | null; matchesSaved: number; errorMessage: string | null },
): Promise<void> {
  await db.query(
    `UPDATE collection_logs
        SET status = $2, finished_at = greatest(now(), started_at), players = $3, matches_saved = $4, error_message = $5
      WHERE id = $1`,
    [id, f.status, f.players, f.matchesSaved, f.errorMessage === null ? null : f.errorMessage.slice(0, 500)],
  );
}

/** 마지막으로 done으로 끝난 수집의 끝난 시각 */
export async function lastDoneAt(db: Queryable): Promise<Date | null> {
  const r = await db.query<{ t: Date | null }>(
    `SELECT max(finished_at) AS t FROM collection_logs WHERE status = 'done'`,
  );
  return r.rows[0]?.t ?? null;
}
