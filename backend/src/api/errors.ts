// API 오류 형식과 오류 미들웨어 (api_contract 3장)
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { isDbConnectionError } from '../db/pool.js';
import { formatError, redact, type Logger } from '../lib/logger.js';
import type { Parsed } from './validate.js';

export type ErrorCode =
  | 'INVALID_PARAMETER'
  | 'PATCH_NOT_FOUND'
  | 'STATS_NOT_FOUND'
  | 'NOT_FOUND'
  | 'STATS_NOT_READY'
  | 'DB_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** 검사 결과를 값으로 풀거나 400 INVALID_PARAMETER */
export function requireParam<T>(p: Parsed<T>, param: string, value: unknown): T {
  if (p.ok) return p.value;
  throw new ApiError(400, 'INVALID_PARAMETER', p.message, { param, value: value ?? null });
}

export function sendError(res: Response, e: ApiError): void {
  res.status(e.status).set('Cache-Control', 'no-store');
  res.json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, new ApiError(404, 'NOT_FOUND', '없는 경로입니다.'));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    if (err instanceof ApiError) return sendError(res, err);
    if (isDbConnectionError(err)) {
      logger.error('DB 연결 실패', { path: req.path, error: formatError(err) });
      return sendError(res, new ApiError(503, 'DB_UNAVAILABLE', '데이터베이스에 연결할 수 없습니다.'));
    }
    // 잘못된 JSON 등 express 자체 4xx
    const status = (err as { status?: unknown })?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return sendError(res, new ApiError(400, 'INVALID_PARAMETER', '잘못된 요청입니다.'));
    }
    // 내부 내용은 응답에 넣지 않고 로그에만
    logger.error('처리하지 못한 오류', { path: req.path, error: formatError(err) });
    if (err instanceof Error && err.stack) logger.error(redact(err.stack));
    return sendError(res, new ApiError(500, 'INTERNAL_ERROR', '서버 오류가 발생했습니다.'));
  };
}
