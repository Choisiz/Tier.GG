// 전적 검색(소환사 상세) 설정값 (back_spec 변경 03 W-3, W-4). 결정 S3·S4.
// API 서버 전용: 수집 CLI와 공유하지 않는다 (서로 다른 프로세스라 메모리 제한기를 나눌 수 없음).

/** 캐시 TTL (ms). 같은 소환사 반복 조회를 줄이는 목적 (결정 S4) */
export const SUMMONER_CACHE_TTL_MS = 60_000;
/** 캐시 최대 항목 수. 넘치면 가장 오래 넣은 것부터 지운다 */
export const SUMMONER_CACHE_MAX = 200;
/** match-v5 ids count (큐 필터 없음) */
export const RECENT_MATCH_COUNT = 20;

/** API 전용 Riot 제한기: Riot 실제 한도(20/100)의 절반 (결정 S3, 수집 CLI와 동시에 돌 수 있어 여유를 둠) */
export const API_RIOT_RATE_LIMIT = {
  perSecondLimit: 10,
  perWindowLimit: 50,
  windowMs: 120_000,
};
