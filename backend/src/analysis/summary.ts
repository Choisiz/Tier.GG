// 2-2 요약 판정 + 말할 순서 (ai_spec B-1, 사용자 결정 2026-11-02: A·B 좋은 점, D·E 부족한 점, C 말하지 않음)
import type { AreaResult, KeyMoment, LaningResult, SpeakList, SubjectResult } from './types.js';

/** 라인전: +1 = 좋은 점, −1 = 부족한 점. 순서는 항목 순서(골드 → 레벨 → KDA → CS) */
export function laningSpeakList(laning: LaningResult | null): SpeakList {
  if (!laning) return { good: [], bad: [] };
  return {
    good: laning.items.filter((x) => x.point > 0).map((x) => x.id),
    bad: laning.items.filter((x) => x.point < 0).map((x) => x.id),
  };
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
