// 4장 공통: 과목 등급 → 점수, 매길 수 없는 과목 제외 후 100점 환산
import { GRADE_POINT, SUMMARY } from './rules.js';
import { round } from './timeline.js';
import type { AreaResult, Facts, Grade, SubjectResult } from './types.js';

export function graded(id: string, weight: number, grade: Grade, facts: Facts, gradePoint = GRADE_POINT[grade]): SubjectResult {
  return {
    id,
    weight,
    grade,
    gradePoint: round(gradePoint, 4),
    score: round(weight * gradePoint, 2),
    impact: round(weight * (gradePoint - 0.5), 2),
    facts,
  };
}

export function ungraded(id: string, weight: number, reason: string, facts: Facts = {}): SubjectResult {
  return { id, weight, grade: null, gradePoint: null, score: null, impact: null, facts, reason };
}

export function areaVerdict(total: number | null): AreaResult['verdict'] {
  if (total === null) return null;
  if (total >= SUMMARY.totalGood) return '잘함';
  if (total < SUMMARY.totalBad) return '부족';
  return '보통';
}

/** 반영 비율 0인 과목은 매기지 않은 것으로 본다. 총점 = Σ(weight × 등급 점수) ÷ Σ(매긴 weight) × 100 */
export function area(weights: Record<string, number>, subjects: SubjectResult[]): AreaResult {
  let w = 0;
  let s = 0;
  for (const x of subjects) {
    if (x.grade === null || x.gradePoint === null || x.weight <= 0) continue;
    w += x.weight;
    s += x.weight * x.gradePoint;
  }
  const total = w > 0 ? round((s / w) * 100, 2) : null;
  return { weights, subjects, total, verdict: areaVerdict(total) };
}
