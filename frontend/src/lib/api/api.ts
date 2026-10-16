import "server-only";
import { isBuildPhase } from "./buildPhase";
import { fetchApi, type ApiResult } from "./client";
import type {
  ChampionStatsResponse,
  MetaResponse,
  Position,
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
