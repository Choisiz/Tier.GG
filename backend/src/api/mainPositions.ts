// 주 포지션 최대 2개 규칙 (계약 9-3, api_contract 2-3)
// pick 내림차순(같으면 포지션 이름 순) 최대 2개. 2순위는 그 챔피언 전체 pick의 10% 이상일 때만.
import { SECONDARY_POSITION_MIN_SHARE } from '../config/api.js';

export function mainPositions(
  rows: readonly { position: string; pick: number }[],
  minSharePercent: number = SECONDARY_POSITION_MIN_SHARE,
): string[] {
  const sorted = [...rows].filter((r) => r.pick > 0).sort((a, b) => b.pick - a.pick || (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  const total = sorted.reduce((s, r) => s + r.pick, 0);
  const out: string[] = [];
  const first = sorted[0];
  if (!first) return out;
  out.push(first.position);
  const second = sorted[1];
  // 정수 비교로 경계(정확히 10%)를 실수 오차 없이: pick / total >= share / 100
  if (second && second.pick * 100 >= minSharePercent * total) out.push(second.position);
  return out;
}

/** 챔피언별로 묶어 주 포지션을 구한다 */
export function mainPositionsByChampion(
  rows: readonly { championId: number; position: string; pick: number }[],
): Map<number, string[]> {
  const by = new Map<number, { position: string; pick: number }[]>();
  for (const r of rows) {
    const list = by.get(r.championId) ?? [];
    list.push({ position: r.position, pick: r.pick });
    by.set(r.championId, list);
  }
  const out = new Map<number, string[]>();
  for (const [id, list] of by) out.set(id, mainPositions(list));
  return out;
}
