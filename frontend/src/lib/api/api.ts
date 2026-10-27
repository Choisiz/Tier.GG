import "server-only";
import { isBuildPhase } from "./buildPhase";
import { fetchApi, type ApiResult } from "./client";
import type {
  ChampionStatsResponse,
  MetaResponse,
  Position,
  SummonerResponse,
  TierListResponse,
} from "./types";

/**
 * 화면이 쓰는 통계 상태.
 * `unavailable`은 빌드 중에만 나온다 — 서비스 중에는 `requireStats`가 오류를 던진다.
 */
export type StatsState<T> =
  | { status: "ok"; data: T }
  | { status: "not_ready" }
  | { status: "not_found" }
  | { status: "unavailable" };

function toState<T>(result: ApiResult<T>): StatsState<T> {
  if (result.ok) return { status: "ok", data: result.data };
  if (result.kind === "not_ready") return { status: "not_ready" };
  if (result.kind === "not_found") return { status: "not_found" };
  return { status: "unavailable" };
}

/**
 * 페이지 본문용 (변경 01 01-2-5, 결정 D6).
 * - 빌드 중 `unavailable`: 그대로 돌려줘 "통계 서버에 연결하지 못했습니다" 안내로 페이지를 만든다.
 * - 서비스 중 `unavailable`: 오류를 던진다 → ISR은 직전 정상 페이지를 유지, 첫 생성이면 error.tsx.
 */
export function requireStats<T>(state: StatsState<T>): StatsState<T> {
  if (state.status === "unavailable" && !isBuildPhase()) {
    throw new Error("통계 서버에 연결하지 못했습니다.");
  }
  return state;
}

/** GET /meta. 푸터처럼 실패해도 페이지를 깨면 안 되는 곳은 이 결과를 그대로 쓴다 */
export async function getMeta(): Promise<StatsState<MetaResponse>> {
  return toState(await fetchApi<MetaResponse>("/meta"));
}

/** GET /champions?position= */
export async function getTierList(position: Position): Promise<StatsState<TierListResponse>> {
  return toState(await fetchApi<TierListResponse>(`/champions?position=${position}`));
}

/**
 * GET /champions/:championId[?position=]
 * @param championKey Data Dragon `key` ("266")
 * @param position 없으면 1순위 주 포지션
 */
export async function getChampionStats(
  championKey: string,
  position?: Position,
): Promise<StatsState<ChampionStatsResponse>> {
  const query = position ? `?position=${position}` : "";
  return toState(
    await fetchApi<ChampionStatsResponse>(
      `/champions/${encodeURIComponent(championKey)}${query}`,
    ),
  );
}

/**
 * 전적 검색 화면이 쓰는 상태 (변경 06, 계약 2-5). 집계 창이 없어 `StatsState`와 분리한다.
 * `invalid`는 계약상 `region != kr`·riotId 형식 오류인데, 라우트가 `region`을 미리 막고
 * riotId는 백엔드가 검사하므로 화면에서는 `not_found`와 같게 취급한다 (4장 상태 처리).
 */
export type SummonerState =
  | { status: "ok"; data: SummonerResponse }
  | { status: "not_found" }
  | { status: "invalid" }
  | { status: "riot_unavailable" }
  | { status: "riot_key_expired" }
  | { status: "unavailable" };

/**
 * GET /summoners/:region/:riotId. 요청마다 새로 부른다 (`cache: "no-store"`, D36).
 * @param riotId `gameName-tagLine` (이미 하이픈으로 합친 값)
 */
export async function getSummoner(
  region: string,
  riotId: string,
): Promise<SummonerState> {
  const result = await fetchApi<SummonerResponse>(
    `/summoners/${encodeURIComponent(region)}/${encodeURIComponent(riotId)}`,
    { cache: "no-store" },
  );
  if (result.ok) return { status: "ok", data: result.data };
  switch (result.kind) {
    case "not_found":
      return { status: "not_found" };
    case "invalid":
      return { status: "invalid" };
    case "riot_unavailable":
      return { status: "riot_unavailable" };
    case "riot_key_expired":
      return { status: "riot_key_expired" };
    default:
      return { status: "unavailable" };
  }
}
