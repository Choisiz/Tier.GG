import "server-only";
import { API_REVALIDATE_SECONDS, API_TIMEOUT_MS, getApiBaseUrl } from "./config";
import type { ApiErrorBody } from "./types";

/**
 * 백엔드 호출 결과.
 * - `not_ready`: 503 STATS_NOT_READY (첫 집계 전, 정상 상태로 그린다)
 * - `not_found`: 404 STATS_NOT_FOUND (그 챔피언·포지션 통계 없음)
 * - `invalid`: 400 INVALID_PARAMETER, 404 NOT_FOUND — 프론트 버그. 화면은 `unavailable`과 같게
 * - `unavailable`: 연결 실패, 시간 초과, 503 DB_UNAVAILABLE, 500, JSON 아님, `API_BASE_URL` 없음
 */
export type ApiFailureKind = "not_ready" | "not_found" | "invalid" | "unavailable";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: ApiFailureKind };

let missingBaseUrlLogged = false;

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
  if (status === 404 && code === "STATS_NOT_FOUND") return "not_found";
  if ((status === 400 && code === "INVALID_PARAMETER") || (status === 404 && code === "NOT_FOUND")) {
    return "invalid";
  }
  return "unavailable";
}

/**
 * 백엔드 GET 호출. 예외를 던지지 않고 결과 종류로 돌려준다.
 * 로그에는 경로·상태·`code`만 남긴다 (기본 URL은 남기지 않는다).
 * @param path `/champions?position=TOP`처럼 `/api/v1` 뒤 경로
 */
export async function fetchApi<T>(path: string): Promise<ApiResult<T>> {
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
    res = await fetch(`${baseUrl}${path}`, {
      next: { revalidate: API_REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    reportUnavailable(path, `연결 실패(${reason})`);
    return { ok: false, kind: "unavailable" };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    reportUnavailable(path, `JSON 아님(HTTP ${res.status})`);
    return { ok: false, kind: "unavailable" };
  }

  if (res.ok) {
    return { ok: true, data: body as T };
  }

  const code = isErrorBody(body) ? body.error.code : null;
  const kind = classifyError(res.status, code);
  if (kind === "invalid") {
    console.error(`[api] 잘못된 요청 ${path} → HTTP ${res.status} ${code}`);
  } else if (kind === "unavailable") {
    reportUnavailable(path, `HTTP ${res.status} ${code ?? "-"}`);
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

