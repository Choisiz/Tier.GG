// createApp(db): 테스트에서 롤백 연결이나 가짜 db를 넣을 수 있게 db를 인자로 받는다.
// 읽기 전용 GET만. CORS 헤더는 주지 않는다 (결정 D6). 수집 코드를 부르지 않는다.
import express, { type Express } from 'express';
import type { Queryable } from '../db/tx.js';
import { createLogger, type Logger } from '../lib/logger.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { championsRouter } from './routes/champions.js';
import { metaRouter } from './routes/meta.js';

export function createApp(db: Queryable, logger: Logger = createLogger('api')): Express {
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

  app.use('/api/v1', metaRouter(db));
  app.use('/api/v1', championsRouter(db));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
