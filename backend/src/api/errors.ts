// API 오류 형식과 오류 미들웨어 (api_contract v2 3장)
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { isDbConnectionError } from '../db/pool.js';
import { formatError, redact, type Logger } from '../lib/logger.js';
import type { Parsed } from './validate.js';

export type ErrorCode =
  | 'INVALID_PARAMETER'
  | 'STATS_NOT_FOUND'
  | 'NOT_FOUND'
  | 'STATS_NOT_READY'
  | 'DB_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  // 전적 검색(소환사 상세, back_spec 변경 03 W-5)
  | 'SUMMONER_NOT_FOUND'
  | 'RIOT_KEY_EXPIRED'
  | 'RIOT_UNAVAILABLE'
  // 게임 피드백 분석(back_spec 변경 05, 05-3)
  | 'MATCH_NOT_FOUND'
  | 'ANALYSIS_UNSUPPORTED'
  | 'ANALYSIS_LIMIT_REACHED'
  | 'ANALYSIS_DISABLED'
  | 'ANALYSIS_BUSY'
  | 'ANALYSIS_TIMEOUT';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    /** 있으면 Retry-After 헤더(초)로 함께 준다 (429·503·504, 변경 05) */
    readonly retryAfterSec?: number,
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
  if (e.retryAfterSec !== undefined) res.set('Retry-After', String(Math.max(0, Math.ceil(e.retryAfterSec))));
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
    // 본문 파싱 오류(깨진 JSON·너무 큼·문자셋): 값은 넣지 않고 param="body"만 (변경 05, 05-1)
    const type = (err as { type?: unknown })?.type;
    if (typeof type === 'string' && /^(entity|encoding|charset|request)\./.test(type)) {
      return sendError(res, new ApiError(400, 'INVALID_PARAMETER', '요청 본문은 2KB 이하 JSON 객체여야 합니다.', { param: 'body' }));
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
