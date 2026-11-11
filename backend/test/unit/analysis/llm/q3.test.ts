// Q3 (ai_spec RAG3): 조언 규칙표 R1~R5 발동/미발동 경계, 상대 라이너 비교, 분:초 표기, 조언 검증기. 유료 호출 0회.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { R1_MIN_WEIGHT, ruleR1, ruleR2R3, ruleR4, ruleR5 } from '../../../../src/analysis/advice.js';
import { templateFor } from '../../../../src/analysis/llm/template.js';
import { verifySlot } from '../../../../src/analysis/llm/verify.js';
import { buildUserPayload } from '../../../../src/analysis/llm/prompt.js';
import type { AnalysisResult, Grade, JudgedResult, PlayScene, SubjectResult } from '../../../../src/analysis/types.js';
import { ctxOf, senaResult, senaSheet, SET5_IDS, set5Sheet } from './helpers.js';

const sena = senaResult();

/** 결과를 복사하고 과목 하나를 바꾼다 */
function withSubject(r: JudgedResult, id: string, patch: Partial<SubjectResult>): JudgedResult {
  const c = structuredClone(r) as JudgedResult;
  for (const area of ['fight', 'macro'] as const) {
    c[area].subjects = c[area].subjects.map((s) => (s.id === id ? { ...s, ...patch, facts: { ...s.facts, ...(patch.facts ?? {}) } } : s));
  }
  return c;
}
const grade = (r: JudgedResult, id: string, g: Grade | null) => withSubject(r, id, { grade: g });

describe('R1 반영 비율', () => {
  it('세나: 교전 시야 E·반영 비율 30·내 0.5 < 상대 1.25 → 발동, 운영 득실도 발동', () => {
    const rs = sena.advice.rules.filter((r) => r.id === 'R1');
    assert.deepEqual(
      rs.map((r) => [r.subjectId, r.kind]),
      [
        ['fight.vision', 'bad'],
        ['macro.advantage', 'bad'],
      ],
    );
    assert.deepEqual(rs[0]!.facts, { weight: 30, me: 0.5, opponent: 1.25, hasScene: true });
    assert.equal(R1_MIN_WEIGHT, 30);
  });
  it('반영 비율 29는 미발동, 30은 발동', () => {
    const opp = null;
    assert.equal(ruleR1(withSubject(sena, 'fight.vision', { weight: 29 }), opp).some((r) => r.subjectId === 'fight.vision'), false);
    assert.equal(ruleR1(withSubject(sena, 'fight.vision', { weight: 30 }), opp).some((r) => r.subjectId === 'fight.vision'), true);
  });
  it('D·E만 발동 (C는 미발동)', () => {
    for (const [g, fired] of [['C', false], ['D', true], ['E', true], [null, false]] as const) {
      assert.equal(ruleR1(grade(sena, 'fight.vision', g), null).some((r) => r.subjectId === 'fight.vision'), fired, String(g));
    }
  });
  it('상대 라이너와 비교: 상대 값이 나보다 높을 때만, 상대 값이 없으면(계산 불가) 비교 없이 발동', () => {
    const opp = (v: number | null) =>
      v === null ? withSubject(sena, 'fight.vision', { grade: null }) : withSubject(sena, 'fight.vision', { grade: 'B', facts: { perObjective: v } });
    const fired = (o: JudgedResult | null) => ruleR1(sena, o).find((r) => r.subjectId === 'fight.vision');
    assert.equal(fired(opp(0.5)), undefined); // 같으면 미발동
    assert.equal(fired(opp(0.4)), undefined); // 상대가 더 낮으면 미발동
    assert.equal(fired(opp(0.51))?.facts.opponent, 0.51);
    assert.equal(fired(opp(null))?.facts.opponent, null); // 상대 과목을 매길 수 없음
    assert.equal(fired(null)?.facts.opponent, null); // 상대 라이너 없음
  });
});

describe('R2·R3 득실 점수 + 딜 등급', () => {
  it('세나: 딜 C라 R2·R3 모두 미발동', () => {
    assert.equal(sena.advice.rules.some((r) => r.id === 'R2' || r.id === 'R3'), false);
    assert.deepEqual(ruleR2R3(sena, 2), []);
  });
  it('딜 D·E + 득실 D·E + 내 데스 → R2를 딜·득실 칸에, 상대가 얻은 점수 = 포지션 점수(서폿 5) × 데스 수', () => {
    for (const g of ['D', 'E'] as const) {
      const rs = ruleR2R3(grade(sena, 'fight.damage', g), 3);
      assert.deepEqual(rs.map((r) => [r.id, r.subjectId]), [
        ['R2', 'fight.damage'],
        ['R2', 'fight.advantage'],
      ]);
      assert.equal(rs[0]!.facts.myDeaths, 3);
      assert.equal(rs[0]!.facts.deathPoints, 15);
    }
  });
  it('딜 A·B + 득실 D·E + 내 데스 → R3 (득실 칸만)', () => {
    for (const g of ['A', 'B'] as const) {
      assert.deepEqual(ruleR2R3(grade(sena, 'fight.damage', g), 1).map((r) => [r.id, r.subjectId]), [['R3', 'fight.advantage']]);
    }
  });
  it('내 데스 0·득실 C·딜 C면 미발동', () => {
    assert.deepEqual(ruleR2R3(grade(sena, 'fight.damage', 'E'), 0), []);
    assert.deepEqual(ruleR2R3(grade(grade(sena, 'fight.damage', 'E'), 'fight.advantage', 'C'), 2), []);
    assert.deepEqual(ruleR2R3(grade(sena, 'fight.damage', 'C'), 2), []);
  });
  it('딜정글 판(set5): R2 발동, 데스 2번 × 정글 5 = 10', () => {
    const s = set5Sheet('KR_8419458143');
    const r2 = s.result.advice.rules.filter((r) => r.id === 'R2');
    assert.equal(r2.length, 2);
    assert.equal(r2[0]!.facts.deathPoints, 10);
  });
});

describe('R4 첫 데스 해석 (5-4-1 문장 그대로)', () => {
  it('세나: 진 싸움에서 아군 딜러가 먼저 죽음 → 부족한 점 칸에 "먼저 잡혀 싸움을 졌습니다"', () => {
    const r4 = ruleR4(sena.notes);
    assert.deepEqual(r4.map((r) => [r.kind, r.facts.text]), [['bad', '먼저 잡혀 싸움을 졌습니다']]);
  });
  it('이긴 싸움 노트는 좋은 점 칸으로, 노트가 없으면 미발동', () => {
    const win = { ...sena.notes[0]!, key: 'TANK_WIN', text: '이니시를 걸어 싸움을 연 것으로 보입니다' };
    assert.deepEqual(ruleR4([win]).map((r) => [r.kind, r.facts.text, r.facts.tank]), [['good', '이니시를 걸어 싸움을 연 것으로 보입니다', true]]);
    assert.deepEqual(ruleR4([]), []);
  });
});

describe('R5 단독 킬·데스', () => {
  const death: PlayScene = { sec: 600, kind: 'DEATH', region: 'RIVER_TOP', enemies: 2, enemyJungler: true };
  const withSolo = (g: Grade, scenes: PlayScene[]) => {
    const r = grade(sena, 'macro.solo', g);
    r.scenes = { ...r.scenes, macroSolo: scenes };
    return r;
  };
  it('D·E + 단독 데스 장면 → 발동 (시각·지역)', () => {
    assert.deepEqual(ruleR5(withSolo('D', [death])).map((r) => r.facts), [{ deathSec: 600, region: 'RIVER_TOP', enemies: 2, enemyJungler: true }]);
    assert.equal(ruleR5(withSolo('E', [death])).length, 1);
  });
  it('C 이상이거나 단독 데스 장면이 없으면 미발동', () => {
    assert.deepEqual(ruleR5(withSolo('C', [death])), []);
    assert.deepEqual(ruleR5(withSolo('E', [{ ...death, kind: 'KILL' }])), []);
  });
  it('원딜 판(set5): R5 발동', () => {
    assert.ok(set5Sheet('KR_8419447142').result.advice.rules.some((r) => r.id === 'R5'));
  });
});

// ---------- 검증기 ----------

const sheet = senaSheet();
const ctx = ctxOf(sheet);
const slot = (id: string) => sheet.slots.find((s) => s.slot === id)!;
const check = (id: string, text: string, factIds: string[]) => verifySlot(slot(id), { text, factIds }, ctx);
const details = (id: string, text: string, factIds: string[]) => check(id, text, factIds).map((f) => `${f.rule}:${f.detail}`);

const R1V = ['rule.R1.fight.vision.weight', 'rule.R1.fight.vision.me', 'rule.R1.fight.vision.opponent'];
const V0 = ['scene.fight.vision.0.min', 'scene.fight.vision.0.objective', 'scene.fight.vision.0.wardsPlaced', 'fight.vision.windowSec'];

describe('Q3 칸 규칙과 프롬프트', () => {
  it('세나 칸: 라인전·요약·결정적 장면은 규칙 없음, 교전 시야 R1, 교전 득실 R4(해석만), 운영 득실 R1', () => {
    const map = Object.fromEntries(sheet.slots.map((s) => [s.slot, s.rules.map((r) => r.id)]));
    assert.deepEqual(map, {
      summary: [],
      'laning.bad.0': [],
      'laning.bad.1': [],
      'fight.bad.0': ['R1'],
      'fight.bad.1': ['R4'],
      'macro.good.0': [],
      'macro.bad.0': [],
      'macro.bad.1': ['R1'],
      'keyMoment.0': [],
      'keyMoment.1': [],
      'keyMoment.2': [],
    });
    assert.deepEqual(slot('fight.bad.0').rules[0]!.required, R1V);
    assert.equal(slot('fight.bad.1').rules[0]!.action, false);
  });
  it('사용자 메시지: 규칙이 있는 칸만 rules(id·요지·근거), R4는 문장 text', () => {
    const p = buildUserPayload(sheet);
    const s = (id: string) => p.slots.find((x) => x.slot === id)!;
    assert.equal(s('laning.bad.0').rules, undefined);
    assert.deepEqual(s('fight.bad.0').rules!.map((r) => [r.id, r.required]), [['R1', R1V]]);
    assert.equal(s('fight.bad.1').rules![0]!.text, '먼저 잡혀 싸움을 졌습니다');
  });
});

describe('Q3 검증기: 조언은 발동한 규칙의 근거를 인용해야 함', () => {
  it('사용자 X: 라인전 조언(규칙 없음)은 실패', () => {
    const t = '15:00 골드가 상대 애쉬보다 703 적었습니다. 다음 판에는 바텀 라인 우리 포탑 쪽에서 상대와 교환하기보다 미니언 막타를 먼저 챙기세요.';
    assert.ok(details('laning.bad.0', t, ['laning.referenceMin', 'laning.opponent', 'laning.gold.diffAbs']).some((d) => d.startsWith('forbidden:근거 없는 조언')));
  });
  it('사용자 X: 교전 시야 "제어 와드를 먼저 두세요"는 R1 근거(반영 비율·내 값·상대 값) 없이 실패', () => {
    const t =
      '오브젝트를 잡기 전 60초 동안의 시야 점수가 오브젝트당 0.5로 낮았습니다. 6:35 상대 팀이 잡은 용 전 60초 동안 내 와드는 0개였습니다. 다음 판에는 용을 잡기 전 60초 안에 아군 앞라인과 함께 아래쪽 강 입구에 제어 와드를 먼저 두세요.';
    assert.ok(details('fight.bad.0', t, ['fight.vision.perObjective', ...V0]).some((d) => d.startsWith('forbidden:조언 근거 미인용')));
  });
  it('사용자 X: 교전 득실 "아군 곁에 붙어 숫자를 맞추세요"는 R4(해석만) 칸이라 실패', () => {
    const t = '16:40 탑 라인 상대 포탑 쪽에서 우리 팀 1킬, 상대 팀 7킬이 났습니다. 다음 판에는 탑 라인 상대 포탑 쪽에서 먼저 잡힌 아군 곁에 미리 붙어 숫자를 맞추세요.';
    assert.ok(details('fight.bad.1', t, ['scene.fight.advantage.0.min', 'scene.fight.advantage.0.region', 'scene.fight.advantage.0.killsOurs', 'scene.fight.advantage.0.killsTheirs']).some((d) => d.includes('해석 문장만')));
  });
  it('R1 근거를 모두 쓰고 factIds에 적으면 통과 ("신경 쓰세요")', () => {
    const t =
      '딜서폿은 오브젝트 전 시야 비중이 큽니다(반영 비율 30). 오브젝트당 시야 점수가 0.5로 상대 라이너 애쉬의 1.25보다 낮았고, 6:35에 잡힌 용 전 60초 동안 내 와드는 0개였습니다. 다음 판에는 오브젝트 전 시야에 신경 쓰세요.';
    assert.deepEqual(check('fight.bad.0', t, ['player.role', 'laning.opponent', 'fight.vision.perObjective', ...R1V, ...V0]), []);
  });
  it('R1 근거 하나(상대 값)가 문장에 없거나 factIds에 없으면 실패', () => {
    const t = '딜서폿은 오브젝트 전 시야 비중이 큽니다(반영 비율 30). 오브젝트당 시야 점수가 0.5로 낮았습니다. 다음 판에는 오브젝트 전 시야에 신경 쓰세요.';
    assert.ok(details('fight.bad.0', t, ['player.role', ...R1V]).some((d) => d.includes('R1(rule.R1.fight.vision.opponent)')));
    const t2 = '딜서폿은 오브젝트 전 시야 비중이 큽니다(반영 비율 30). 오브젝트당 시야 점수가 0.5로 상대의 1.25보다 낮았습니다. 다음 판에는 오브젝트 전 시야에 신경 쓰세요.';
    assert.ok(details('fight.bad.0', t2, ['player.role', 'rule.R1.fight.vision.weight', 'rule.R1.fight.vision.me', 'fight.vision.perObjective']).some((d) => d.startsWith('number') || d.includes('조언 근거 미인용')));
  });
  it('명령형("~하세요"·"~해라")과 "신경 써"도 조언으로 본다 (규칙 없는 칸에서 실패)', () => {
    for (const t of ['미니언 막타를 먼저 챙기세요.', '미니언 막타를 먼저 챙겨라.', '막타에 신경 써야 합니다.']) {
      assert.ok(details('laning.bad.0', t, []).some((d) => d.startsWith('forbidden:근거 없는 조언')), t);
    }
    assert.ok(!details('laning.bad.0', '15:00 골드가 상대 애쉬보다 703 적었습니다.', ['laning.referenceMin', 'laning.opponent', 'laning.gold.diffAbs']).length);
  });
  it('R4 칸: 5-4-1 문장 그대로 + 먼저 죽은 사람·결과는 통과, 다른 5-4-1 문장은 실패, R4 없는 칸에서 5-4-1 문장은 실패', () => {
    const ids = ['rule.R4.bad.deathMin', 'rule.R4.bad.firstDeath', 'rule.R4.bad.outcome'];
    assert.deepEqual(check('fight.bad.1', '16:40 싸움에서 우리 팀 다른 사람이 먼저 죽었고 상대 팀이 더 얻어, 먼저 잡혀 싸움을 졌습니다.', ids), []);
    assert.ok(details('fight.bad.1', '16:40 싸움에서 혼자 들어갔거나 팀이 따라오지 못한 것으로 보입니다.', ids).some((d) => d.includes('R4 문장')));
    assert.ok(details('macro.bad.1', '먼저 잡혀 싸움을 졌습니다.', []).some((d) => d.includes('R4가 발동한 칸에서만')));
  });
  it('"반영 비율"은 R1 칸에서만, 요약 칸의 조언은 실패', () => {
    assert.ok(details('fight.bad.1', '반영 비율이 큰 과목입니다.', []).some((d) => d.includes('반영 비율')));
    const ids = slot('summary').factIds;
    assert.ok(details('summary', '라인전은 열세였고, 오브젝트 싸움과 그 밖의 운영은 부족했습니다. 다음 판에는 시야에 신경 쓰세요.', ids).some((d) => d.startsWith('forbidden:근거 없는 조언')));
  });
});

describe('Q3 템플릿: 조언 없음, 분:초, set5 모든 칸 통과', () => {
  it('set5 5판 모든 칸 검증 통과, "다음 판"·"분" 시각 표기 없음', () => {
    for (const id of SET5_IDS) {
      const sh = set5Sheet(id);
      for (const s of sh.slots) {
        const t = templateFor(sh, s);
        assert.deepEqual(verifySlot(s, t, ctxOf(sh)), [], `${id} ${s.slot}`);
        assert.doesNotMatch(t.text, /다음 판|세요|\d+(?:\.\d)?분(?!당)/, `${id} ${s.slot}: ${t.text}`);
      }
    }
  });
});

// 타입 확인용 (AnalysisResult에 advice가 있다)
const _check: AnalysisResult['advice'] = sena.advice;
void _check;
