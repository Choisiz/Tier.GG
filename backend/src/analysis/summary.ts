// 2-2 요약 판정 + 말할 순서 (ai_spec B-1, 사용자 결정 2026-11-02: A·B 좋은 점, D·E 부족한 점, C 말하지 않음)
import type { AreaResult, KeyMoment, LaningResult, SpeakList, SubjectResult } from './types.js';

/** 라인전 말할 과목 (Q4) */
export const LANING_SUBJECTS = { growth: 'laning.growth', deaths: 'laning.deaths', roam: 'laning.roam' } as const;

/** 2-1에서 "잘 따라감"으로 말하는 칸 (골드·레벨 중 하나가 뒤져도 좋은 점 칸에서 말한다) */
const LANING_KEPT_UP: readonly string[] = ['GAP_COVERED', 'BASICS_KEPT'];

/**
 * 라인전 (Q4, 결정 1: 2-1 표로 판정):
 * - 좋은 점: 2-1 성장(우세 칸·"잘 따라감" 칸) → 2-2 내 로밍 우위
 * - 부족한 점: 2-1 성장(열세 칸) → 2-3 기준 시점 전 데스 → 2-2 상대 로밍 우위
 * 골드·레벨 모두 같은 칸(EVEN)은 성장을 말하지 않는다. 순서는 고정(판정 → 원인 → 라인 밖).
 */
export function laningSpeakList(laning: LaningResult | null): SpeakList {
  if (!laning) return { good: [], bad: [] };
  const good: string[] = [];
  const bad: string[] = [];
  if (laning.cell.verdict === '우세' || LANING_KEPT_UP.includes(laning.cell.id)) good.push(LANING_SUBJECTS.growth);
  else if (laning.cell.verdict === '열세') bad.push(LANING_SUBJECTS.growth);
  if (laning.deaths.length > 0) bad.push(LANING_SUBJECTS.deaths);
  if (laning.roam?.verdict === 'ME') good.push(LANING_SUBJECTS.roam);
  if (laning.roam?.verdict === 'OPPONENT') bad.push(LANING_SUBJECTS.roam);
  return { good, bad };
}

/**
 * 교전·운영: A·B = 좋은 점, D·E = 부족한 점, C = 말하지 않음.
 * 순서는 |impact| = |반영 비율 × (등급 점수 − 50%)| 큰 순, 같으면 반영 비율 큰 순, 그래도 같으면 과목 순서.
 */
export function areaSpeakList(area: AreaResult): SpeakList {
  const order = (xs: SubjectResult[]) =>
    xs
      .map((x, i) => ({ x, i }))
      .sort((a, b) => Math.abs(b.x.impact ?? 0) - Math.abs(a.x.impact ?? 0) || b.x.weight - a.x.weight || a.i - b.i)
      .map(({ x }) => x.id);
  const spoken = area.subjects.filter((s) => s.grade !== null && s.weight > 0);
  return {
    good: order(spoken.filter((s) => s.grade === 'A' || s.grade === 'B')),
    bad: order(spoken.filter((s) => s.grade === 'D' || s.grade === 'E')),
  };
}

export function buildSummary(
  laning: LaningResult | null,
  fight: AreaResult,
  macro: AreaResult,
  keyMoments: readonly KeyMoment[],
) {
  return {
    laning: laning?.verdict ?? null,
    fight: fight.verdict,
    macro: macro.verdict,
    keyMomentIndex: keyMoments.length > 0 ? 0 : null,
  };
}
