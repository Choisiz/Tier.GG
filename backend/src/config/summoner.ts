// 전적 검색(소환사 상세) 설정값 (back_spec 변경 03 W-3, W-4). 결정 S3·S4.
// API 서버 전용: 수집 CLI와 공유하지 않는다 (서로 다른 프로세스라 메모리 제한기를 나눌 수 없음).

/** 캐시 TTL (ms). 같은 소환사 반복 조회를 줄이는 목적 (결정 S4) */
export const SUMMONER_CACHE_TTL_MS = 60_000;
/** 캐시 최대 항목 수. 넘치면 가장 오래 넣은 것부터 지운다 */
export const SUMMONER_CACHE_MAX = 200;
/** match-v5 ids count (큐 필터 없음) */
export const RECENT_MATCH_COUNT = 20;

/**
 * API 전용 Riot 제한기: 1초 18회 / 120초 90회 (변경 04 결정 X1, Riot 실제 한도 20/100의 90%).
 * 변경 03에서는 절반(10/50)이었으나, 라인전(timeline) 호출이 더해져 신규 검색 1회가 최대 44회라 올렸다.
 * 운영 규칙: 수집 CLI(19/98)와 API 서버를 같은 키로 **동시에 돌리지 않는다**. 동시에 돌리면 Riot 실제 한도를 넘는다.
 */
export const API_RIOT_RATE_LIMIT = {
  perSecondLimit: 18,
  perWindowLimit: 90,
  windowMs: 120_000,
};

// ───────── 라인전 15분 골드 (변경 04) ─────────

/** 경기 캐시 TTL: 끝난 게임은 불변이라 길게 (결정 X2) */
export const MATCH_LANE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** 경기 캐시 최대 항목 수 (약 5MB 이내). 넘치면 가장 오래 넣은 것부터 지운다 */
export const MATCH_LANE_CACHE_MAX = 5000;
/** lane-gold 한 번에 받는 matchId 최대 수 (결정 X3) */
export const LANE_GOLD_MAX_IDS = 10;
/** 제한기 대기가 이 시간(ms)을 넘으면 남은 호출은 pending (결정 X3) */
export const LANE_GOLD_MAX_WAIT_MS = 1500;
/** retryAfterSec 상한 (초) */
export const LANE_GOLD_RETRY_MAX_SEC = 120;
/** 15분 시점 프레임 index (프레임은 매분, index 15 = 15:00 근처) */
export const LANE_GOLD_FRAME_INDEX = 15;
/** 이보다 짧은 게임은 timeline을 부르지 않고 unavailable (초) */
export const LANE_GOLD_MIN_DURATION_SEC = 900;
/** 한 요청 안에서 동시에 처리하는 경기 수 */
export const LANE_GOLD_CONCURRENCY = 5;
