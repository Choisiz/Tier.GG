// API 규칙 상수 (back_spec 7-4)

export const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;
export type Position = (typeof POSITIONS)[number];

/** 표시용(meta.rules). 실제 판정은 DB 뷰 champion_tier_view */
export const MIN_TIER_PICK = 50;
/** 2순위 주 포지션 최소 비율 (%) */
export const SECONDARY_POSITION_MIN_SHARE = 10;
/** 최신 패치 게임 수가 이보다 적으면 직전 패치로 대체 (결정 D3) */
export const FALLBACK_MIN_GAMES = 5000;
/** 상세 룬·스펠·스킬 상위 N개 (아이템은 전체, 결정 D4) */
export const DETAIL_TOP_N = 2;
/** 성공 응답 Cache-Control max-age (결정 D5) */
export const CACHE_MAX_AGE_SEC = 600;
