// 규칙 단위: 등급 경계값 바로 위·아래, 반영 비율 합 100, 100점 환산 (ai_spec B-3 "규칙 단위")
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLE_LABEL } from '../../../src/analysis/role.js';
import {
  DAMAGE_EXPECTED,
  FIGHT_ADVANTAGE_CUTS,
  FIGHT_VISION_CUTS,
  FIGHT_WEIGHTS,
  JUNGLE_OBJECTIVE_CUTS,
  MACRO_ADVANTAGE_CUTS,
  MACRO_WEIGHTS,
  NORMAL_VISION_CUTS,
  SIDE_CUTS,
  SOLO_CUTS,
  gradeByCuts,
  gradeDamageDiff,
  gradeFromPoint,
  type Cuts,
} from '../../../src/analysis/rules.js';
import { area, graded, ungraded } from '../../../src/analysis/score.js';
import type { Role } from '../../../src/analysis/types.js';

const ROLES = Object.keys(ROLE_LABEL) as Role[];
const sum = (o: object) => Object.values(o).reduce((s: number, v: number) => s + v, 0);

describe('반영 비율', () => {
  it('교전: 유형 10개 모두 합 100', () => {
    assert.equal(ROLES.length, 10);
    for (const r of ROLES) assert.equal(sum(FIGHT_WEIGHTS[r]), 100, r);
  });
  it('운영: 유형 10개 모두 합 100, 서폿 중후반 파밍은 0', () => {
    for (const r of ROLES) assert.equal(sum(MACRO_WEIGHTS[r]), 100, r);
    assert.equal(MACRO_WEIGHTS.SUPPORT_TANK.farm, 0);
    assert.equal(MACRO_WEIGHTS.SUPPORT_DAMAGE.farm, 0);
    assert.equal(MACRO_WEIGHTS.SUPPORT_UTILITY.farm, 0);
    assert.equal(MACRO_WEIGHTS.SUPPORT_TANK.side, 0);
    assert.equal(MACRO_WEIGHTS.SUPPORT_UTILITY.side, 0);
  });
  it('딜 기대 비중: 실제 중앙값으로 고친 칸 (5-2 굵은 값)', () => {
    assert.deepEqual(DAMAGE_EXPECTED.ADC, [22, 23, 28]);
    assert.equal(DAMAGE_EXPECTED.JUNGLE_DAMAGE[0], 16);
    assert.equal(DAMAGE_EXPECTED.JUNGLE_TANK[0], 13);
    assert.deepEqual(DAMAGE_EXPECTED.SUPPORT_UTILITY.slice(0, 2), [11, 6]);
  });
});

/** 각 하한 바로 위·아래에서 등급이 바뀌는지 */
function checkCuts(name: string, cuts: Cuts, eps: number) {
  const grades = ['A', 'B', 'C', 'D'] as const;
  const lower = ['B', 'C', 'D', 'E'] as const;
  cuts.forEach((c, i) => {
    assert.equal(gradeByCuts(c, cuts), grades[i], `${name} ${c} 이상 = ${grades[i]}`);
    assert.equal(gradeByCuts(c - eps, cuts), lower[i], `${name} ${c} 바로 아래 = ${lower[i]}`);
  });
}

describe('등급 경계 (하한 이상이면 그 등급)', () => {
  it('교전 이득 여부 78/64/40/24 (2026-11-02 재계산), 운영 이득 74/62/42/29', () => {
    assert.deepEqual(FIGHT_ADVANTAGE_CUTS, [78, 64, 40, 24]);
    checkCuts('교전 이득', FIGHT_ADVANTAGE_CUTS, 0.01);
    checkCuts('운영 이득', MACRO_ADVANTAGE_CUTS, 0.01);
    assert.equal(gradeByCuts(4.5, FIGHT_ADVANTAGE_CUTS), 'E');
  });
  it('정글 오브젝트 82/42/22/10 (2026-11-02 재계산. 예: 용 3 + 바론 = 80 → B, 용 3 + 전령 + 유충 3 = 52 → B)', () => {
    assert.deepEqual(JUNGLE_OBJECTIVE_CUTS, [82, 42, 22, 10]);
    assert.equal(gradeByCuts(52, JUNGLE_OBJECTIVE_CUTS), 'B');
    checkCuts('정글 오브젝트', JUNGLE_OBJECTIVE_CUTS, 1);
    assert.equal(gradeByCuts(80, JUNGLE_OBJECTIVE_CUTS), 'B');
  });
  it('시야·평소 시야 포지션별', () => {
    for (const [p, c] of Object.entries(FIGHT_VISION_CUTS)) checkCuts(`시야 ${p}`, c, 0.001);
    for (const [p, c] of Object.entries(NORMAL_VISION_CUTS)) checkCuts(`평소 시야 ${p}`, c, 0.001);
    assert.equal(gradeByCuts(0.5, FIGHT_VISION_CUTS.UTILITY), 'E');
    assert.equal(gradeByCuts(0.91, NORMAL_VISION_CUTS.UTILITY), 'E');
  });
  it('단독 킬·데스: +2 A, +1 B, 0 C, −1 D, −2 E', () => {
    assert.deepEqual(
      [3, 2, 1, 0, -1, -2, -3].map((v) => gradeByCuts(v, SOLO_CUTS)),
      ['A', 'A', 'B', 'C', 'D', 'E', 'E'],
    );
  });
  it('사이드 압박: 정글·서폿은 0이면 E, 0보다 크면 D', () => {
    assert.equal(gradeByCuts(0, SIDE_CUTS.UTILITY), 'E');
    assert.equal(gradeByCuts(0.01, SIDE_CUTS.UTILITY), 'D');
    assert.equal(gradeByCuts(0, SIDE_CUTS.JUNGLE), 'E');
    assert.equal(gradeByCuts(5.99, SIDE_CUTS.JUNGLE), 'D');
    assert.equal(gradeByCuts(6, SIDE_CUTS.JUNGLE), 'C');
    assert.equal(gradeByCuts(87.4, SIDE_CUTS.UTILITY), 'B');
    checkCuts('사이드 탑', SIDE_CUTS.TOP, 0.01);
  });
  it('딜 차이: +6 A · +3 B · ±3 안 C · −3 D · −6 E (−3·−6은 이하 쪽)', () => {
    assert.deepEqual(
      [6, 5.99, 3, 2.99, 0, -2.99, -3, -5.99, -6, -10].map(gradeDamageDiff),
      ['A', 'B', 'B', 'C', 'C', 'C', 'D', 'D', 'E', 'E'],
    );
  });
  it('구간 평균 등급: 가장 가까운 등급, 정확히 중간이면 높은 쪽', () => {
    assert.equal(gradeFromPoint(0.25), 'D');
    assert.equal(gradeFromPoint(0.375), 'C');
    assert.equal(gradeFromPoint(0.125), 'D');
    assert.equal(gradeFromPoint(0.8), 'B');
  });
});

describe('총점 (4장)', () => {
  it('Σ(반영 비율 × 등급 점수). 예: 탱탑 이득 C + 딜 B + 시야 A + 오브젝트 A = 62.5', () => {
    const a = area({}, [
      graded('fight.advantage', 60, 'C', {}),
      graded('fight.damage', 30, 'B', {}),
      graded('fight.vision', 5, 'A', {}),
      graded('fight.objective', 5, 'A', {}),
    ]);
    assert.equal(a.total, 62.5);
    assert.equal(a.verdict, '보통');
  });
  it('매길 수 없는 과목은 빼고 남은 비율로 100점 환산', () => {
    const a = area({}, [
      ungraded('fight.advantage', 60, '없음'),
      graded('fight.damage', 30, 'B', {}),
      graded('fight.vision', 5, 'A', {}),
      graded('fight.objective', 5, 'A', {}),
    ]);
    // (22.5 + 5 + 5) ÷ 40 × 100
    assert.equal(a.total, 81.25);
    assert.equal(a.verdict, '잘함');
  });
  it('모든 과목을 매길 수 없으면 총점·판정 null', () => {
    const a = area({}, [ungraded('x', 50, '없음'), ungraded('y', 50, '없음')]);
    assert.equal(a.total, null);
    assert.equal(a.verdict, null);
  });
  it('판정 경계: 70 이상 잘함, 40 미만 부족', () => {
    const at = (g: 'A' | 'B' | 'C' | 'D' | 'E', pt: number) => area({}, [graded('x', 100, g, {}, pt)]).verdict;
    assert.equal(at('B', 0.7), '잘함');
    assert.equal(at('B', 0.6999), '보통');
    assert.equal(at('C', 0.4), '보통');
    assert.equal(at('D', 0.3999), '부족');
  });
});
