// createApp(db): 테스트에서 롤백 연결이나 가짜 db를 넣을 수 있게 db를 인자로 받는다.
// 읽기 전용 GET만. CORS 헤더는 주지 않는다 (결정 D6). 수집 코드를 부르지 않는다.
import express, { type Express } from 'express';
import type { Queryable } from '../db/tx.js';
import { createLogger, type Logger } from '../lib/logger.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { championsRouter } from './routes/champions.js';
import { metaRouter } from './routes/meta.js';
import { createStaleWarner } from './window.js';

/**
 * query: /health처럼 한 문장이면 되는 읽기.
 * snapshot: 통계 엔드포인트의 모든 읽기를 한 스냅숏(REPEATABLE READ READ ONLY 트랜잭션 1개)에서 한다 (변경 01-6-4).
 * server.ts는 풀로(readSnapshot), 테스트는 롤백 연결로(fn(client)) 만든다.
 */
export interface ApiDb extends Queryable {
  snapshot<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

export interface ApiDeps {
  db: ApiDb;
  logger: Logger;
  /** 지금 시각 (ms). isStale 계산용, 테스트에서 고정 */
  now: () => number;
  /** isStale을 보면 1시간에 1번 경고 */
  warnIfStale: (aggregatedAt: Date, nowMs: number) => void;
}

export function createApp(db: ApiDb, logger: Logger = createLogger('api'), opts: { now?: () => number } = {}): Express {
  const deps: ApiDeps = { db, logger, now: opts.now ?? Date.now, warnIfStale: createStaleWarner(logger) };
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // ETag·304 없음 (api_contract 4장)

  // 요청 1줄 로그: 메서드 경로 상태 ms
  app.use((req, res, next) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });

  // GET(HEAD)만 받는다. 그 밖의 메서드는 없는 경로와 같게 404
  app.use((req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    return notFoundHandler(req, _res, next);
  });

  app.use('/api/v1', metaRouter(deps));
  app.use('/api/v1', championsRouter(deps));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
