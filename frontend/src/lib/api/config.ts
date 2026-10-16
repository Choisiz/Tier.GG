import "server-only";

/** 페이지·fetch 재검증 주기(초). 계약 4장 권장값 */
export const API_REVALIDATE_SECONDS = 3600;

/** 백엔드 응답을 기다리는 최대 시간(ms). 넘으면 `unavailable` */
export const API_TIMEOUT_MS = 10_000;

/**
 * 백엔드 읽기 API 기본 URL (`/api/v1`까지, 끝 `/` 없음).
 * `next.config.ts`가 루트 `.env`에서 이 값만 골라 넣는다 (변경 01 D8).
 * 값이 없으면 `null` — 기본값으로 조용히 localhost에 붙지 않는다.
 */
export function getApiBaseUrl(): string | null {
  const value = process.env.API_BASE_URL?.trim();
  if (!value) {
    return null;
  }
  return value.replace(/\/+$/, "");
}
