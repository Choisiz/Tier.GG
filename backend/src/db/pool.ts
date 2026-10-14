// pg Pool 1개. Session pooler 연결 수 한도를 넘지 않게 작은 max를 쓴다 (API 5, CLI 2).
import pg from 'pg';
import { formatError, type Logger } from '../lib/logger.js';

export function createPool(databaseUrl: string, max: number, logger: Logger): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'tiergg-backend',
  });
  // 유휴 연결 오류가 프로세스를 죽이지 않게. 메시지는 가려서 출력
  pool.on('error', (err) => logger.error('DB 연결 오류', { error: formatError(err) }));
  return pool;
}

/** DB 연결 실패 계열 오류인지 (API 503 DB_UNAVAILABLE, CLI 중단 판단) */
export function isDbConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = String((err as { code?: unknown }).code ?? '');
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE'].includes(code)) return true;
  if (code.startsWith('08') || code === '57P01' || code === '57P03' || code === '53300') return true;
  return /Connection terminated|timeout exceeded when trying to connect|Client has encountered a connection error/i.test(
    err.message,
  );
}
