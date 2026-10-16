// 진입점 1: API 서버 (읽기 전용). Riot 키를 읽지 않고 수집 코드를 부르지 않는다.
// npm run dev (watch) / npm start
import { createApp, type ApiDb } from './api/app.js';
import { EnvError, loadApiPort, loadDbEnv } from './config/env.js';
import { createPool } from './db/pool.js';
import { readSnapshot } from './db/snapshot.js';
import { createLogger, formatError } from './lib/logger.js';

const logger = createLogger('server');

function main(): void {
  const { databaseUrl } = loadDbEnv();
  const port = loadApiPort();
  const pool = createPool(databaseUrl, 5, logger);
  // health는 풀에 바로, 통계 엔드포인트는 요청마다 스냅숏 트랜잭션 1개 (변경 01-6-4)
  const db: ApiDb = {
    query: (text, values) => pool.query(text, values),
    snapshot: (fn) => readSnapshot(pool, fn, logger),
  };
  const app = createApp(db);
  const server = app.listen(port, () => logger.info('API 서버 시작', { url: `http://localhost:${port}/api/v1` }));
  server.on('error', (err) => {
    logger.error('서버 시작 실패', { error: formatError(err) });
    process.exitCode = 1;
  });

  const shutdown = (signal: string) => {
    logger.info('종료 중', { signal });
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

try {
  main();
} catch (err) {
  logger.error(err instanceof EnvError ? err.message : formatError(err));
  process.exitCode = 1;
}
