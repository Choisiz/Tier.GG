// API 규칙 상수 (back_spec 7-4)

export const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;
export type Position = (typeof POSITIONS)[number];

/** 표시용(meta.rules). 실제 판정은 DB 뷰 champion_tier_view */
export const MIN_TIER_PICK = 50;
/** 2순위 주 포지션 최소 비율 (%) */
export const SECONDARY_POSITION_MIN_SHARE = 10;
/** 통계 창 길이(일). 수집(startTime·out_of_window·aggregate)과 meta.rules.windowDays가 함께 쓴다. 응답의 실제 값은 stats_window.days */
export const WINDOW_DAYS = 14;
/** 지금 − aggregatedAt이 이 시간을 넘으면 isStale (하루 주기 24시간 + 여유 2시간, back_spec 변경 01-6-3) */
export const STALE_AFTER_HOURS = 26;
/** 상세 룬·스펠·스킬 상위 N개 (아이템은 전체, 결정 D4) */
export const DETAIL_TOP_N = 2;
/** 성공 응답 Cache-Control max-age (결정 D5) */
export const CACHE_MAX_AGE_SEC = 600;
