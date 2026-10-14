// 수집 잠금 + collection_logs 시작·종료 기록 (back_spec 3-2 0단계, 종료)
import type pg from 'pg';
import type { Logger } from '../lib/logger.js';
import { closeStaleRunning, finishRun, startRun, type RunStatus } from '../repositories/logRepository.js';

const LOCK_SQL_KEY = `hashtext('tiergg:collector')`;

export class CollectorLockedError extends Error {
  override name = 'CollectorLockedError';
  constructor() {
    super('다른 수집이 실행 중입니다 (수집 잠금을 잡을 수 없음)');
  }
}

/**
 * 세션 잠금은 연결에 붙으므로, 잠금 전용 연결을 실행 내내 들고 있는다.
 * 빌려 간 연결에는 pg-pool의 오류 리스너가 없어서, 쉬는 동안 연결이 끊기면(DB 재시작·네트워크) 'error' 이벤트가
 * 처리되지 않아 프로세스가 바로 죽는다 (Review에서 pg_terminate_backend로 재현). 그래서 리스너를 붙여
 * 잠금을 잃었다고 표시하고 onLost로 알린다. 잠금이 풀린 채 수집을 계속하면 두 수집이 겹칠 수 있으므로 호출하는 쪽이 멈춘다.
 */
export class CollectorLock {
  private lostError: Error | null = null;

  private constructor(private readonly client: pg.PoolClient) {}

  /** 잠금 연결이 끊겨 잠금을 잃었는지 */
  get lost(): boolean {
    return this.lostError !== null;
  }

  static async acquire(pool: pg.Pool, onLost?: (err: Error) => void): Promise<CollectorLock> {
    const client = await pool.connect();
    try {
      const r = await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(${LOCK_SQL_KEY}) AS ok`);
      if (!r.rows[0]?.ok) throw new CollectorLockedError();
      const lock = new CollectorLock(client);
      client.on('error', (err: Error) => {
        if (lock.lostError) return;
        lock.lostError = err;
        onLost?.(err);
      });
      return lock;
    } catch (err) {
      client.release();
      throw err;
    }
  }

  async release(): Promise<void> {
    if (this.lostError) {
      // 끊긴 연결: 잠금은 이미 서버에서 풀렸다. 연결은 풀에 돌려주지 않고 버린다
      this.client.release(this.lostError);
      return;
    }
    try {
      await this.client.query(`SELECT pg_advisory_unlock(${LOCK_SQL_KEY})`);
    } finally {
      this.client.release();
    }
  }
}

export class RunLog {
  private constructor(
    private readonly pool: pg.Pool,
    readonly id: number,
  ) {}

  /** 잠금을 잡은 뒤에 부른다: 남은 running을 failed로 닫고 새 running 1줄 */
  static async start(pool: pg.Pool, logger: Logger): Promise<RunLog> {
    const closed = await closeStaleRunning(pool);
    if (closed > 0) logger.warn('비정상 종료로 남은 running 기록을 failed로 닫음', { rows: closed });
    const id = await startRun(pool);
    logger.info('collection_logs 시작', { id });
    return new RunLog(pool, id);
  }

  async finish(
    status: Exclude<RunStatus, 'running'>,
    players: number | null,
    matchesSaved: number,
    errorMessage: string | null,
  ): Promise<void> {
    await finishRun(this.pool, this.id, { status, players, matchesSaved, errorMessage });
  }
}
