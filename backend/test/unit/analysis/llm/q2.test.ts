// Q2 (ai_spec): 장면·기준 시간 facts, 은어·막연한 조언 금지, 조언은 장면 하나를 짚어야 함, 템플릿, 지식 조각 검사. 유료 호출 0회.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { templateFor } from '../../../../src/analysis/llm/template.js';
import { verifySlot } from '../../../../src/analysis/llm/verify.js';
import { SYSTEM_PROMPT } from '../../../../src/analysis/llm/prompt.js';
import { parseKnowledgeFile } from '../../../../src/analysis/rag/chunks.js';
import { ctxOf, senaSheet, SET5_IDS, set5Sheet } from './helpers.js';

const sheet = senaSheet();
const ctx = ctxOf(sheet);
const slot = (id: string) => sheet.slots.find((s) => s.slot === id)!;
const check = (id: string, text: string, factIds: string[]) => verifySlot(slot(id), { text, factIds }, ctx);
const rules = (id: string, text: string, factIds: string[]) => check(id, text, factIds).map((f) => f.rule);

// 세나 판: fight.bad.0 = fight.vision, fight.bad.1 = fight.advantage, macro.bad.1 = macro.advantage
const VISION = ['fight.vision.windowSec', 'fight.vision.perObjective'];
const V0 = ['scene.fight.vision.0.min', 'scene.fight.vision.0.objective', 'scene.fight.vision.0.wardsPlaced'];

describe('Q2 facts: 기준 시간·장면', () => {
  it('교전 시야 칸: 기준 60초 + 장면 3개(시각·오브젝트·잡은 팀·와드 수), 세나 첫 장면 = 6.6분 상대가 잡은 용, 와드 0', () => {
    const ids = slot('fight.bad.0').factIds;
    assert.equal(sheet.byId.get('fight.vision.windowSec')!.value, 60);
    assert.ok(ids.includes('fight.vision.windowSec'));
    for (const i of [0, 1, 2]) assert.ok(ids.includes(`scene.fight.vision.${i}.wardsPlaced`), String(i));
    assert.ok(!ids.includes('scene.fight.vision.3.min'));
    assert.deepEqual(sheet.byId.get('scene.fight.vision.0.min')!.display, ['6.6', '6']);
    assert.equal(sheet.byId.get('scene.fight.vision.0.objective')!.value, '용');
    assert.equal(sheet.byId.get('scene.fight.vision.0.taken')!.value, '상대 팀이 잡음');
    assert.equal(sheet.byId.get('scene.fight.vision.0.wardsPlaced')!.value, 0);
  });
  it('교전·운영 득실 칸: 기준 40초 + 싸움 장면(킬 수·득실·처음 죽은 사람·지역)', () => {
    assert.ok(slot('fight.bad.1').factIds.includes('fight.windowSec'));
    const m = slot('macro.bad.1').factIds;
    assert.ok(m.includes('fight.windowSec'));
    assert.equal(sheet.byId.get('scene.macro.advantage.0.region')!.value, '우리 기지 근처');
    assert.equal(sheet.byId.get('scene.macro.advantage.0.firstDeath')!.value, '내가 먼저 죽음');
    assert.equal(sheet.byId.get('scene.macro.advantage.0.killsOurs')!.value, 4);
  });
  it('라인전 칸: 비교 시점 전 데스의 지역·관여한 상대·상대 정글', () => {
    const ids = slot('laning.bad.1').factIds;
    assert.ok(ids.includes('laning.deathsBefore.0.region'));
    assert.equal(sheet.byId.get('laning.deathsBefore.0.region')!.value, '바텀 라인 우리 포탑 쪽');
    assert.equal(sheet.byId.get('laning.deathsBefore.1.enemies')!.value, 2);
  });
  it('"낀" 라벨이 없다 (내가 참여한)', () => {
    for (const f of sheet.facts) assert.doesNotMatch(f.label, /낀/, f.id);
  });
});

describe('Q2 검증기: 은어·막연한 조언 금지', () => {
  it('"낀"·"꼈"은 실패, "느낀"은 통과', () => {
    assert.ok(rules('fight.bad.1', '낀 오브젝트 싸움에서 우리 팀 몫이 낮았습니다.', []).includes('forbidden'));
    assert.ok(rules('fight.bad.1', '싸움에 꼈지만 우리 팀 몫이 낮았습니다.', []).includes('forbidden'));
    assert.ok(!rules('fight.bad.1', '부담을 느낀 것으로 보입니다.', []).includes('forbidden'));
  });
  it('"~해 볼 수 있습니다"·"이어 가"는 실패', () => {
    assert.ok(rules('fight.bad.0', '다음 판에는 6.6분 용 전에 와드를 두어 볼 수 있습니다.', ['scene.fight.vision.0.min']).includes('forbidden'));
    assert.ok(rules('fight.bad.0', '다음 판에도 6.6분 용 전 시야를 이어 가세요.', ['scene.fight.vision.0.min']).includes('forbidden'));
  });
});

describe('Q2 검증기: 조언은 장면 하나를 짚어야 함', () => {
  it('장면 없는 조언("상대 정글 위치를 확인하고 움직이세요")은 실패', () => {
    const f = check('macro.bad.1', '다음 판에는 상대 정글 위치를 확인하고 아군 가까이 움직이세요.', []);
    assert.ok(f.some((x) => x.rule === 'forbidden' && x.detail.startsWith('장면 없는 조언')));
  });
  it('장면 fact를 factIds에 적어도 문장에 시각·오브젝트·지역이 없으면 실패', () => {
    const f = check('fight.bad.0', '다음 판에는 강 입구에 제어 와드를 먼저 두세요.', ['scene.fight.vision.0.wardsPlaced']);
    assert.ok(f.some((x) => x.detail.startsWith('장면 없는 조언')));
  });
  it('장면 시각+오브젝트를 짚고 기준 시간·숫자가 facts와 맞으면 통과', () => {
    const text =
      '오브젝트를 잡기 전 60초 동안의 시야 점수가 오브젝트당 0.5로 낮았습니다. 6.6분 상대 팀이 잡은 용 전 60초 동안 내 와드는 0개였습니다. 다음 판에는 용을 잡기 전 60초 안에 아래쪽 강 입구에 제어 와드를 먼저 두세요.';
    assert.deepEqual(check('fight.bad.0', text, [...VISION, ...V0, 'scene.fight.vision.0.taken']), []);
  });
  it('앞 문장의 시각만으로는 안 됨: 조언 문장 안에서 장면을 짚어야 함', () => {
    const text = '6.6분 용 전 와드가 0개였습니다. 다음 판에는 강 입구에 제어 와드를 먼저 두세요.';
    const f = check('fight.bad.0', text, ['scene.fight.vision.0.min', 'scene.fight.vision.0.objective', 'scene.fight.vision.0.wardsPlaced']);
    assert.ok(f.some((x) => x.detail.startsWith('장면 없는 조언')));
  });
  it('지역 이름(괄호 설명 없이)으로 짚어도 통과', () => {
    const text = '다음 판에는 우리 기지 근처에서 싸움이 날 때 아군이 모인 뒤 들어가세요.';
    assert.deepEqual(check('macro.bad.1', text, ['scene.macro.advantage.0.region']), []);
  });
  it('조언 속 숫자도 facts 검증: 없는 "1분 전"은 실패', () => {
    const text = '다음 판에는 6.6분 용 1분 전에 강 입구에 제어 와드를 두세요.';
    assert.ok(rules('fight.bad.0', text, ['scene.fight.vision.0.min', 'scene.fight.vision.0.objective']).includes('number'));
  });
  it('"60초"는 기준 시간 fact가 factIds에 있을 때만, 단위 "초"', () => {
    assert.ok(rules('fight.bad.0', '오브젝트를 잡기 전 60초 동안 시야가 낮았습니다.', []).includes('number'));
    assert.deepEqual(rules('fight.bad.0', '오브젝트를 잡기 전 60초 동안 시야가 낮았습니다.', ['fight.vision.windowSec']), []);
  });
  it('조언 없는 문장은 장면이 없어도 통과 (조언은 선택)', () => {
    assert.deepEqual(rules('macro.good.0', '분당 포탑 피해량이 87.4로 사이드 압박이 좋았습니다.', ['macro.side.perMinute']), []);
  });
});

describe('Q2 템플릿', () => {
  it('set5 5판 모든 칸: 은어 "낀" 0, 조언 0, 교전 득실·시야 칸은 기준 시간을 말하고 장면 1개를 짚는다', () => {
    for (const id of SET5_IDS) {
      const sh = set5Sheet(id);
      for (const s of sh.slots) {
        const t = templateFor(sh, s);
        assert.doesNotMatch(t.text, /낀|다음 판/, `${id} ${s.slot}`);
        assert.deepEqual(verifySlot(s, t, ctxOf(sh)), [], `${id} ${s.slot}`);
        if (s.subjectId === 'fight.advantage') assert.match(t.text, /앞뒤 40초 동안 내가 참여한 싸움.*\d분/, `${id} ${s.slot}`);
        if (s.subjectId === 'macro.advantage') assert.match(t.text, /앞뒤 40초 밖에서 내가 참여한 싸움/, `${id} ${s.slot}`);
        if (s.subjectId === 'fight.vision') assert.match(t.text, /잡기 전 60초 동안.*\d분 .+ 60초 동안 내가 설치한 와드는 \d+개/, `${id} ${s.slot}`);
      }
    }
  });
  it('세나 판 교전 시야 템플릿 문장 고정', () => {
    assert.equal(
      templateFor(sheet, slot('fight.bad.0')).text,
      '오브젝트를 잡기 전 60초 동안의 시야 점수가 오브젝트당 0.5로 낮았습니다. 6.6분 용을 잡기 전 60초 동안 내가 설치한 와드는 0개였습니다.',
    );
  });
});

describe('Q2 프롬프트·지식 조각', () => {
  it('시스템 프롬프트에 장면·조언 규칙과 기준 시간 규칙이 있다', () => {
    assert.match(SYSTEM_PROMPT, /9-1\. 기준 시간/);
    assert.match(SYSTEM_PROMPT, /## 장면과 조언/);
    assert.match(SYSTEM_PROMPT, /언제.*어디서.*무엇을/);
  });
  it('조각에 "낀"·"볼 수 있다"·"이어 가"가 있으면 오류 (경고 아님)', () => {
    const doc = (body: string) =>
      `# t\n\n### fight.vision.ALL.bad.01 시야 낮을 때\n- meta: role=ALL, area=fight, subject=fight.vision, polarity=bad\n${body}\n`;
    for (const body of ['시야가 낮았을 수 있다. 다음 판에는 와드를 두어 볼 수 있다.', '낀 싸움이 많았을 수 있다. 다음 판에는 와드를 먼저 둔다.', '시야가 낮았을 수 있다. 다음 판에도 와드를 이어 가며 둔다.']) {
      const r = parseKnowledgeFile(doc(body), 't.md');
      assert.equal(r.errors.length, 1, body);
    }
    const ok = parseKnowledgeFile(doc('시야가 낮았을 수 있다. 상대가 용을 잡았다면 다음 판에는 그 전에 아래쪽 강 입구에 제어 와드를 먼저 둔다.'), 't.md');
    assert.deepEqual(ok.errors, []);
  });
});
