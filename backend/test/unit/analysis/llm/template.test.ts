// 템플릿 (ai_spec 2-6): 과목 26개 × 방향 + 요약·결정적 장면·라인전 비교 불가가 모두 검증기를 통과
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFacts } from '../../../../src/analysis/llm/facts.js';
import { ro, templateFor } from '../../../../src/analysis/llm/template.js';
import { verifySlot } from '../../../../src/analysis/llm/verify.js';
import type { AnalysisResult } from '../../../../src/analysis/types.js';
import { ctxOf, NAMES, secondResult, senaResult } from './helpers.js';

/** 한 과목을 좋은 점·부족한 점 양쪽에 억지로 넣어 템플릿 두 개를 모두 만든다 */
function bothWays(r: AnalysisResult, area: 'laning' | 'fight' | 'macro', id: string): AnalysisResult {
  const copy = structuredClone(r);
  copy.speakOrder = { laning: { good: [], bad: [] }, fight: { good: [], bad: [] }, macro: { good: [], bad: [] } };
  copy.speakOrder[area] = { good: [id], bad: [id] };
  return copy;
}

describe('템플릿: 모든 과목 × 방향이 검증기를 통과', () => {
  const covered = new Set<string>();
  const failures: string[] = [];
  for (let pid = 1; pid <= 10; pid++) {
    const r = senaResult(pid);
    const subjects: ['laning' | 'fight' | 'macro', string][] = [
      ...(r.laning?.items.map((x) => ['laning', x.id] as ['laning', string]) ?? []),
      ...r.fight.subjects.filter((s) => s.grade !== null).map((s) => ['fight', s.id] as ['fight', string]),
      ...r.macro.subjects.filter((s) => s.grade !== null).map((s) => ['macro', s.id] as ['macro', string]),
    ];
    for (const [area, id] of subjects) {
      const sheet = buildFacts(bothWays(r, area, id), NAMES);
      for (const slot of sheet.slots.filter((s) => s.area === area)) {
        const t = templateFor(sheet, slot);
        const f = verifySlot(slot, t, ctxOf(sheet));
        covered.add(`${id}.${slot.kind}`);
        if (f.length > 0) failures.push(`p${pid} ${slot.slot} ${id}: ${t.text} → ${JSON.stringify(f)}`);
      }
    }
  }
  it('세나 판 10명으로 26개(라인전 8 + 교전 8 + 운영 10) 모두 만들어 봄', () => {
    assert.equal(covered.size, 26, [...covered].sort().join(','));
  });
  it('실패 0', () => {
    assert.deepEqual(failures, []);
  });
});

describe('템플릿: 요약·결정적 장면 (벌어짐/좁혀짐)', () => {
  it('세나 판 10명의 요약·결정적 장면 템플릿이 모두 통과하고, 두 방향이 모두 나온다', () => {
    const dirs = new Set<string>();
    for (let pid = 1; pid <= 10; pid++) {
      const sheet = buildFacts(senaResult(pid), NAMES);
      for (const slot of sheet.slots.filter((s) => s.area === 'summary' || s.area === 'keyMoment')) {
        const t = templateFor(sheet, slot);
        assert.deepEqual(verifySlot(slot, t, ctxOf(sheet)), [], `p${pid} ${slot.slot}: ${t.text}`);
        if (slot.area === 'keyMoment') dirs.add(sheet.result.keyMoments[slot.index!]!.direction);
      }
    }
    assert.deepEqual([...dirs].sort(), ['narrowed', 'widened']);
  });
  it('세나 요약 템플릿 문장', () => {
    const sheet = buildFacts(senaResult(5), NAMES);
    const t = templateFor(sheet, sheet.slots[0]!);
    assert.equal(t.text, '라인전은 열세였고, 오브젝트 싸움은 부족했고, 그 밖의 운영은 부족했습니다. 15.1분 킬 5개가 난 싸움 뒤 골드 격차가 3,895 벌어졌습니다.');
  });
});

describe('템플릿: 라인전 비교 불가·장면 없음', () => {
  it('스냅샷 없는 판(KR_8408851980): 라인전 칸 없음, 요약 템플릿이 통과', () => {
    for (let pid = 1; pid <= 10; pid++) {
      const r = secondResult(pid);
      assert.equal(r.laning, null);
      const sheet = buildFacts(r, NAMES);
      assert.equal(sheet.slots.filter((s) => s.area === 'laning').length, 0);
      for (const slot of sheet.slots) {
        const t = templateFor(sheet, slot);
        assert.deepEqual(verifySlot(slot, t, ctxOf(sheet)), [], `p${pid} ${slot.slot}: ${t.text}`);
      }
    }
  });
});

describe('숫자 뒤 조사 로/으로', () => {
  it('끝소리에 맞춰 고른다', () => {
    for (const n of ['1', '2', '0.5', '4', '87.4', '7', '8', '9', '1.5']) assert.equal(ro(n), '로', n);
    for (const n of ['3', '0.93', '6', '10', '2,000', '0.40', '100']) assert.equal(ro(n), '으로', n);
  });
});
