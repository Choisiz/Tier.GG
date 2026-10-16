import "server-only";
import type { Position } from "./types";

/** 탭 순서 (= 계약 `/meta`의 `positions` 순서) */
export const POSITIONS: readonly Position[] = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"];

/** 화면 이름 */
export const POSITION_LABELS: Record<Position, string> = {
  TOP: "탑",
  JUNGLE: "정글",
  MIDDLE: "미드",
  BOTTOM: "원딜",
  UTILITY: "서폿",
};

/** URL 조각 = API 값 소문자 그대로 (변경 01 D1) */
export type PositionSlug = "top" | "jungle" | "middle" | "bottom" | "utility";

export function toPositionSlug(position: Position): PositionSlug {
  return position.toLowerCase() as PositionSlug;
}

/** URL 조각 → API 값. 정확히 소문자일 때만 (그 밖은 `null`) */
export function fromPositionSlug(slug: string): Position | null {
  return POSITIONS.find((position) => toPositionSlug(position) === slug) ?? null;
}

/** 리스트 탭 주소. 탑은 `/champions`, 나머지는 `/champions/lane/{slug}` */
export function tierListHref(position: Position): string {
  return position === "TOP" ? "/champions" : `/champions/lane/${toPositionSlug(position)}`;
}
