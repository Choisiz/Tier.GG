// 수집 단계들이 함께 쓰는 실행 문맥
import type pg from 'pg';
import type { CollectionConfig, RiotClientConfig } from '../config/collection.js';
import type { Logger } from '../lib/logger.js';
import type { RiotClient } from '../riot/client.js';

export interface CollectorContext {
  pool: pg.Pool;
  riot: RiotClient;
  cfg: CollectionConfig;
  riotCfg: RiotClientConfig;
  logger: Logger;
  /** 창 시작 시각: 실행을 시작할 때 한 번 정해 ② startTime과 ③ out_of_window에 같은 값을 쓴다 (변경 01-4) */
  window: { startMs: number; startTimeSec: number };
  /** Ctrl+C를 받으면 true. 단계들은 게임/플레이어 사이에서 확인하고 멈춘다 */
  stop: { requested: boolean };
}

export class UserAbortError extends Error {
  override name = 'UserAbortError';
  constructor() {
    super('사용자 중단');
  }
}

export class TooManyFailuresError extends Error {
  override name = 'TooManyFailuresError';
}
