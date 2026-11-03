import "server-only";
import { API_REVALIDATE_SECONDS, API_TIMEOUT_MS, getApiBaseUrl } from "./config";
import type { ApiErrorBody } from "./types";

/**
 * 백엔드 호출 결과.
 * - `not_ready`: 503 STATS_NOT_READY (첫 집계 전, 정상 상태로 그린다)
 * - `not_found`: 404 STATS_NOT_FOUND / SUMMONER_NOT_FOUND (그 챔피언·포지션 통계, 또는 소환사가 없음)
 * - `invalid`: 400 INVALID_PARAMETER, 404 NOT_FOUND — 프론트 버그. 화면은 `unavailable`과 같게
 * - `unavailable`: 연결 실패, 시간 초과, 503 DB_UNAVAILABLE, 500, JSON 아님, `API_BASE_URL` 없음
 * - `riot_unavailable`: 502 RIOT_UNAVAILABLE (전적 검색, 계약 2-5)
 * - `riot_key_expired`: 503 RIOT_KEY_EXPIRED (전적 검색, 계약 2-5)
 */
export type ApiFailureKind =
  | "not_ready"
  | "not_found"
  | "invalid"
  | "unavailable"
  | "riot_unavailable"
  | "riot_key_expired";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiFailureKind };

let missingBaseUrlLogged = false;

/** 로그에 남길 경로에서 `puuid` 값을 가린다 (라인전 프록시, 변경 08) */
function redactPath(path: string): string {
  return path.replace(/([?&]puuid=)[^&]*/, "$1***");
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) {
    return false;
  }
  const error = (value as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/** HTTP 상태 + 오류 `code` → 결과 종류 (분기는 `code`로만, 계약 3장) */
function classifyError(status: number, code: string | null): ApiFailureKind {
  if (status === 503 && code === "STATS_NOT_READY") return "not_ready";
  if (status === 404 && (code === "STATS_NOT_FOUND" || code === "SUMMONER_NOT_FOUND")) {
    return "not_found";
  }
  if ((status === 400 && code === "INVALID_PARAMETER") || (status === 404 && code === "NOT_FOUND")) {
    return "invalid";
  }
  if (status === 502 && code === "RIOT_UNAVAILABLE") return "riot_unavailable";
  if (status === 503 && code === "RIOT_KEY_EXPIRED") return "riot_key_expired";
  return "unavailable";
}

/** 호출별 캐시 옵션. 기본은 기존 그대로(`revalidate: 3600`), 변경 06은 `"no-store"`만 추가한다 (D36) */
export type FetchApiOptions = {
  /** `"no-store"`면 캐시하지 않고 매번 새로 부른다 (전적 검색, 계약 2-5) */
  cache?: "no-store";
};

/**
 * 백엔드 GET 호출. 예외를 던지지 않고 결과 종류로 돌려준다.
 * 로그에는 경로·상태·`code`만 남긴다 (기본 URL은 남기지 않는다).
 * @param path `/champions?position=TOP`처럼 `/api/v1` 뒤 경로
 * @param options 생략하면 기존 통계 화면과 같은 `revalidate: 3600` 캐시를 쓴다
 */
export async function fetchApi<T>(
  path: string,
  options?: FetchApiOptions,
): Promise<ApiResult<T>> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    if (!missingBaseUrlLogged) {
      missingBaseUrlLogged = true;
      console.warn("[api] API_BASE_URL이 설정되지 않았습니다. 통계를 불러오지 않습니다.");
    }
    return { ok: false, kind: "unavailable" };
  }

  let res: Response;
  try {
    res = await fetch(
      `${baseUrl}${path}`,
      options?.cache === "no-store"
        ? { cache: "no-store", signal: AbortSignal.timeout(API_TIMEOUT_MS) }
        : {
            next: { revalidate: API_REVALIDATE_SECONDS },
            signal: AbortSignal.timeout(API_TIMEOUT_MS),
          },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    reportUnavailable(redactPath(path), `연결 실패(${reason})`);
    return { ok: false, kind: "unavailable" };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    reportUnavailable(redactPath(path), `JSON 아님(HTTP ${res.status})`);
    return { ok: false, kind: "unavailable" };
  }

  if (res.ok) {
    return { ok: true, data: body as T };
  }

  const code = isErrorBody(body) ? body.error.code : null;
  const kind = classifyError(res.status, code);
  if (kind === "invalid") {
    console.error(`[api] 잘못된 요청 ${redactPath(path)} → HTTP ${res.status} ${code}`);
  } else if (kind === "unavailable") {
    reportUnavailable(redactPath(path), `HTTP ${res.status} ${code ?? "-"}`);
  }
  return { ok: false, kind };
}

/* ───────── 연결 실패 로그 ─────────
 * 빌드 중에는 페이지 수만큼(260여 번) 실패하므로 프로세스마다 첫 1번만 경고한다.
 */
let unavailableCount = 0;

function reportUnavailable(path: string, reason: string): void {
  unavailableCount += 1;
  if (unavailableCount === 1) {
    console.warn(
      `[api] 통계 서버에 연결하지 못했습니다 (${path}, ${reason}). 빌드 중이면 통계 자리에 안내를 넣어 페이지를 만듭니다.`,
    );
  }
}


/* ───────── POST (변경 10, 계약 2-7) ─────────
 * 기존 `ApiFailureKind`는 그대로 두고, POST는 상태·`code`·`details`를 그대로 담아 돌려준다
 * (화면 문구가 `details.reason`·`retryAfterSec`까지 보기 때문). 기존 GET 화면은 영향 없음.
 */

/**
 * POST 실패.
 * - `http`: 백엔드가 계약 3장 형식의 오류 본문을 줬다
 * - `timeout`: `timeoutMs` 안에 답이 없음 (`TimeoutError`)
 * - `unavailable`: `API_BASE_URL` 없음, 연결 실패, JSON 아님, 오류 본문 형식 아님
 */
export type FeedbackFailure =
  | { ok: false; kind: "http"; status: number; code: string; details: Record<string, unknown> | null }
  | { ok: false; kind: "timeout" }
  | { ok: false; kind: "unavailable" };

export type PostApiResult<T> = { ok: true; data: T } | FeedbackFailure;

/**
 * 백엔드 POST 호출. 예외를 던지지 않는다. 캐시하지 않는다(`no-store`).
 * 로그에는 메서드·경로·상태·`code`만 남긴다. 본문(`puuid` 등)은 절대 남기지 않는다.
 * @param path `/matches/KR_1/feedback`처럼 `/api/v1` 뒤 경로 (경로에 개인 값을 넣지 않는다)
 */
export async function postApi<T>(
  path: string,
  body: unknown,
  options: { timeoutMs: number },
): Promise<PostApiResult<T>> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    console.warn(`[api] POST ${path} → API_BASE_URL 없음`);
    return { ok: false, kind: "unavailable" };
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    if (reason === "TimeoutError") {
      console.warn(`[api] POST ${path} → 시간 초과(${options.timeoutMs}ms)`);
      return { ok: false, kind: "timeout" };
    }
    console.warn(`[api] POST ${path} → 연결 실패(${reason})`);
    return { ok: false, kind: "unavailable" };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    console.warn(`[api] POST ${path} → JSON 아님(HTTP ${res.status})`);
    return { ok: false, kind: "unavailable" };
  }

  if (res.ok) {
    return { ok: true, data: json as T };
  }

  if (!isErrorBody(json)) {
    console.warn(`[api] POST ${path} → HTTP ${res.status} (오류 형식 아님)`);
    return { ok: false, kind: "unavailable" };
  }
  const { code, details } = json.error;
  const log = res.status === 400 ? console.error : console.warn;
  log(`[api] POST ${path} → HTTP ${res.status} ${code}`);
  return {
    ok: false,
    kind: "http",
    status: res.status,
    code,
    details: details && typeof details === "object" ? details : null,
  };
}
