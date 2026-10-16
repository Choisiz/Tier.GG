import type { ItemInfo } from "./types";

/** 아이템 분류 결과 (변경 01 D3) */
export type ItemCategory = "core" | "boots" | "excluded";

/** 시작 아이템으로 보는 가격 상한 (재료 없음 + 이 값 미만) */
const STARTER_GOLD_LIMIT = 1000;

/**
 * 아이템 거르기 규칙 (front_spec 변경 01 01-1-4). 위에서부터 차례로 판단한다.
 * 1. Data Dragon에 없음 → excluded (호출하는 쪽에서 `info`가 없을 때)
 * 2. 태그 Consumable / Trinket → excluded (제어 와드·물약·장신구)
 * 3. 재료 없음 + 가격 1000 미만 → excluded (도란·정글 펫·서폿 시작템·장화 1001)
 * 4. 태그 Boots 또는 신발로 만드는 아이템 → boots (2단계 신발은 `into`가 있어도 여기서 신발로 분류,
 *    태그에 Boots가 없는 3단계 신발 건메탈 군화 3172도 여기서 신발 — Review 수정)
 * 5. 상위 아이템 있음(`into`) → excluded (하위 재료)
 * 6. 나머지 → core (변신 아이템 무라마나 등 포함)
 */
export function categorizeItem(info: ItemInfo | undefined): ItemCategory {
  if (!info) return "excluded";
  if (info.tags.includes("Consumable") || info.tags.includes("Trinket")) return "excluded";
  if (!info.hasFrom && info.goldTotal < STARTER_GOLD_LIMIT) return "excluded";
  if (info.tags.includes("Boots") || info.builtFromBoots) return "boots";
  if (info.hasInto) return "excluded";
  return "core";
}

/** 핵심 아이템 표시 개수 (D9) */
export const CORE_ITEM_COUNT = 3;

/** 신발을 보여줄 최소 사용률(%). 미만이면 신발 칸을 숨긴다 */
export const BOOTS_MIN_PICK_RATE = 5;
