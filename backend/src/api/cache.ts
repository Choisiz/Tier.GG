// 캐시 헤더 (api_contract 4장, 결정 D5): 성공 public, max-age=600 / health·오류 no-store
import type { Response } from 'express';
import { CACHE_MAX_AGE_SEC } from '../config/api.js';

export function cacheOk(res: Response): Response {
  return res.set('Cache-Control', `public, max-age=${CACHE_MAX_AGE_SEC}`);
}
