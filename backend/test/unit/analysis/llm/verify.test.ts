// 검증기 (ai_spec 2-6): 숫자 추출, 숫자·방향·금지어·길이·이름·모양
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { numberDisplay } from '../../../../src/analysis/llm/facts.js';
import { checkFirstAnswer, extractNumbers, findChampionNames, numberMatchesFact, verifySlot } from '../../../../src/analysis/llm/verify.js';
import { SUBJECT_DIRECTION_WORDS } from '../../../../src/analysis/llm/labels.js';
import { ALL_NAMES, ctxOf, passingAnswer, senaSheet, set5Sheet } from './helpers.js';

const sheet = senaSheet();
const ctx = ctxOf(sheet);
const slot = (id: string) => sheet.slots.find((s) => s.slot === id)!;
const rules = (id: string, text: string, factIds: string[]) => verifySlot(slot(id), { text, factIds }, ctx).map((f) => f.rule);

const GOLD = ['laning.referenceMin', 'laning.opponent', 'laning.gold.diffAbs'];
const KM0 = ['keyMoment.0.startMin', 'keyMoment.0.gapChangeAbs', 'keyMoment.0.kills'];

describe('숫자 뽑기', () => {
  it('쉼표·소수·%p·분·부호·어림', () => {
    const t = extractNumbers('15.1분 골드 3,895, 딜 3.46%p, 약 3,900, 3,900 넘게, 4,000 가까이, -2');
    assert.deepEqual(
      t.map((x) => [x.value, x.approx]),
      [
        [15.1, null],
        [3895, null],
        [3.46, null],
        [3900, 'about'],
        [3900, 'over'],
        [4000, 'under'],
        [-2, null],
      ],
    );
  });
  it('한글 수사 + 단위도 숫자로 본다 ("두 번째"는 서수라 뺀다, "한 번도" = 0)', () => {
    assert.deepEqual(
      extractNumbers('두 번 죽었고 세 명이 왔습니다').map((x) => x.value),
      [2, 3],
    );
    assert.deepEqual(extractNumbers('두 번째 싸움').map((x) => x.value), []);
    assert.deepEqual(extractNumbers('한 번도 없었습니다').map((x) => x.value), [0]);
  });
  it('"1차 포탑" 같은 이름 속 숫자와 범위 기호는 빼거나 부호로 보지 않는다', () => {
    assert.deepEqual(extractNumbers('바텀 1차 포탑을 잃었습니다').map((x) => x.value), []);
    assert.deepEqual(extractNumbers('15-20분').map((x) => x.value), [15, 20]);
  });
});

describe('검사 3: 숫자', () => {
  it('맞는 숫자는 통과', () => {
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 상대 애쉬보다 703 적었습니다.', GOLD), []);
  });
  it('facts에 없는 숫자(800)는 실패', () => {
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 상대 애쉬보다 800 적었습니다.', GOLD), ['number']);
  });
  it('"약 700"은 통과, "약 800"은 실패 (step 100 반올림)', () => {
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 상대 애쉬보다 약 700 적었습니다.', GOLD), []);
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 상대 애쉬보다 약 800 적었습니다.', GOLD), ['number']);
  });
  it('"3,900 넘게"는 실제 3,895라 거부, "약 3,900"·"3,900 가까이"·"3,800 넘게"는 통과', () => {
    assert.deepEqual(rules('keyMoment.0', '15분 싸움 뒤 골드 격차가 3,900 넘게 벌어졌습니다.', KM0), ['number']);
    assert.deepEqual(rules('keyMoment.0', '15분 싸움 뒤 골드 격차가 약 3,900 벌어졌습니다.', KM0), []);
    assert.deepEqual(rules('keyMoment.0', '15분 싸움 뒤 골드 격차가 3,900 가까이 벌어졌습니다.', KM0), []);
    assert.deepEqual(rules('keyMoment.0', '15분 싸움 뒤 골드 격차가 3,800 넘게 벌어졌습니다.', KM0), []);
  });
  it('어림은 approx가 있는 fact만 (킬 수 "약 5개"는 실패)', () => {
    assert.deepEqual(rules('keyMoment.0', '15분 킬 약 5개 싸움 뒤 격차가 3,895 벌어졌습니다.', KM0), ['number']);
  });
  it('숫자가 맞아도 factIds에 그 fact가 없으면 실패', () => {
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 703 적었습니다.', ['laning.referenceMin']), ['number']);
  });
  it('소수 %p는 원래 값과 첫째 자리만, 정수 반올림은 실패', () => {
    const f = { id: 'x', label: 'x', value: 3.46, unit: '%p', display: numberDisplay(3.46) };
    const ok = (t: string) => extractNumbers(t).every((tok) => numberMatchesFact(tok, f));
    assert.equal(ok('3.46%p'), true);
    assert.equal(ok('3.5%p'), true);
    assert.equal(ok('3%p'), false);
    assert.equal(ok('약 3%p'), false);
  });
  it('한글 수사 "두 번"도 fact와 대조 (기준 전 데스 2번은 통과, "세 번"은 실패)', () => {
    const ids = [...GOLD, 'laning.deathsBefore.count'];
    assert.deepEqual(rules('laning.bad.0', '15분 전에 두 번 죽어 골드가 상대 애쉬보다 703 적었습니다.', ids), []);
    assert.deepEqual(rules('laning.bad.0', '15분 전에 세 번 죽어 골드가 상대 애쉬보다 703 적었습니다.', ids), ['number']);
  });
});

describe('검사 2: 방향', () => {
  const ids = sheet.slots.find((s) => s.slot === 'summary')!.factIds;
  it('요약: 세 영역 판정어가 있어야 함', () => {
    assert.deepEqual(rules('summary', '라인전은 열세였고, 오브젝트 싸움과 그 밖의 운영 모두 부족했습니다.', ids), []);
    assert.ok(rules('summary', '라인전은 비슷했고, 오브젝트 싸움과 그 밖의 운영 모두 부족했습니다.', ids).includes('direction'));
  });
  it('요약: 반대 방향 단어 금지 (열세인데 "우세")', () => {
    assert.ok(rules('summary', '라인전은 우세 같았지만 열세였고, 오브젝트 싸움과 운영은 부족했습니다.', ids).includes('direction'));
  });
  it('결정적 장면: 벌어졌는데 "좁혀졌습니다"는 실패', () => {
    assert.deepEqual(rules('keyMoment.0', '15분 싸움 뒤 골드 격차가 3,895 좁혀졌습니다.', KM0), ['direction', 'direction']);
    const km2 = ['keyMoment.2.startMin', 'keyMoment.2.gapChangeAbs'];
    assert.deepEqual(rules('keyMoment.2', '22분 싸움 뒤 골드 격차가 465 줄었습니다.', km2), []);
  });
});

describe('검사 4: 금지어', () => {
  it('등급·총점·N점·반영 비율', () => {
    assert.ok(rules('fight.bad.0', '시야는 E 등급입니다.', []).includes('forbidden'));
    assert.ok(rules('fight.bad.0', '교전 총점이 낮았습니다.', []).includes('forbidden'));
    assert.ok(rules('fight.bad.0', '반영 비율이 큰 과목입니다.', []).includes('forbidden'));
  });
  it('"시야 점수"는 허용', () => {
    assert.deepEqual(rules('fight.bad.0', '오브젝트 전 시야 점수가 오브젝트당 0.5로 낮았습니다.', ['fight.vision.perObjective']), []);
  });
  it('해석어는 "보입니다"가 있어야 함', () => {
    assert.deepEqual(rules('fight.bad.1', '이니시를 잘못 걸었습니다.', []), ['forbidden']);
    assert.deepEqual(rules('fight.bad.1', '무리한 진입이 있었던 것으로 보입니다.', []), []);
  });
});

describe('검사 5·6: 길이와 이름', () => {
  it('170자 넘거나 4문장이면 실패 (Q2: 2문장 120자 → 3문장 170자)', () => {
    assert.ok(rules('fight.bad.0', '가'.repeat(171), []).includes('length'));
    assert.ok(!rules('fight.bad.0', '가'.repeat(170), []).includes('length'));
    assert.ok(rules('fight.bad.0', '낮았습니다. 낮았습니다. 낮았습니다. 낮았습니다.', []).includes('length'));
    assert.ok(!rules('fight.bad.0', '낮았습니다. 낮았습니다. 낮았습니다.', []).includes('length'));
  });
  it('판에 없는 챔피언 이름은 실패, 상대 라이너 이름은 통과', () => {
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 이즈리얼보다 703 적었습니다.', GOLD), ['name']);
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 애쉬보다 703 적었습니다.', GOLD), []);
  });
  it('이름 탐지는 이름 뒤가 조사·끝일 때만 ("오른쪽"의 "오른"은 이름이 아님)', () => {
    assert.deepEqual(findChampionNames('오른쪽으로 갔습니다', ALL_NAMES), []);
    assert.deepEqual(findChampionNames('오른이 탱커입니다', ALL_NAMES), ['오른']);
  });
});

describe('검사 1: 모양', () => {
  it('없는 fact ID·이 칸에서 못 쓰는 fact ID는 실패', () => {
    assert.deepEqual(rules('laning.bad.0', '골드가 적었습니다.', ['nope']), ['shape']);
    assert.deepEqual(rules('laning.bad.0', '골드가 적었습니다.', ['keyMoment.1.kills']), ['shape']);
  });
  it('템플릿으로 채운 답은 모든 칸 통과', () => {
    const c = checkFirstAnswer(passingAnswer(sheet), ctx);
    assert.equal(c.passed.size, sheet.slots.length);
    assert.deepEqual(c.failures, []);
  });
  it('빠진 칸은 shape 실패, 엔진이 안 고른 과목·범위 밖 장면은 extras', () => {
    const a = passingAnswer(sheet);
    a.sections.laning.bad.pop();
    a.sections.fight.good.push({ subjectId: 'fight.damage', text: '좋았습니다.', factIds: [] });
    a.keyMoments.push({ index: 7, text: '벌어졌습니다.', factIds: [] });
    const c = checkFirstAnswer(a, ctx);
    assert.deepEqual(c.failures.map((f) => [f.slot, f.rule]), [['laning.bad.1', 'shape']]);
    assert.equal(c.extras.length, 2);
  });
});

describe('검사 3-1: 단위 (Q1)', () => {
  it('숫자 바로 뒤 단위어를 읽는다 (공백 1칸, "분당"·"번째"는 단위로 보지 않음)', () => {
    assert.deepEqual(
      extractNumbers('1킬 5데스, 3,895골드, 7.4개, 5.7%p, 28.7%, 8 레벨, 두 번, 15분, 3 분당').map((x) => x.unit),
      ['킬', '데스', '골드', '개', '%p', '%', '레벨', '분', null, '번'],
    );
  });
  const KM1 = ['keyMoment.1.startMin', 'keyMoment.1.killsOurs', 'keyMoment.1.killsTheirs', 'keyMoment.1.gapChangeAbs'];
  it('팀 킬은 "킬"로 쓰면 통과, "데스"로 쓰면 실패 (원딜 km1 "1킬 5데스" 유형)', () => {
    // 세나 km1: 우리 팀 0킬, 상대 팀 3킬
    assert.deepEqual(rules('keyMoment.1', '16.7분 싸움에서 우리 팀 0킬, 상대 팀 3킬로 골드 격차가 3,887 벌어졌습니다.', KM1), []);
    assert.deepEqual(rules('keyMoment.1', '16.7분 싸움에서 0킬 3데스로 골드 격차가 3,887 벌어졌습니다.', KM1), ['number']);
  });
  it('플레이어 데스 fact는 "데스"·"번" 허용, 골드 차이에 "개"는 실패, 단위어 없으면 값만 본다', () => {
    const ids = [...GOLD, 'laning.deathsBefore.count'];
    assert.deepEqual(rules('laning.bad.0', '15분 전 2데스로 골드가 상대 애쉬보다 703골드 적었습니다.', ids), []);
    assert.deepEqual(rules('laning.bad.0', '15분 전 2번 죽어 골드가 상대 애쉬보다 703 적었습니다.', ids), []);
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 상대 애쉬보다 703개 적었습니다.', GOLD), ['number']);
    assert.deepEqual(rules('laning.bad.0', '15골드 시점에 상대 애쉬보다 703 적었습니다.', GOLD), ['number']);
  });
  it('%와 %p를 구분한다 (차이는 %p)', () => {
    assert.deepEqual(rules('fight.bad.1', '오브젝트 싸움 득실 중 우리 팀 몫이 4.5%에 그쳤습니다.', ['fight.advantage.sharePct']), []);
    assert.deepEqual(rules('fight.bad.1', '오브젝트 싸움 득실 중 우리 팀 몫이 4.5%p에 그쳤습니다.', ['fight.advantage.sharePct']), ['number']);
  });
});

describe('검사 2-1: 좋은 점·부족한 점 칸 방향 (Q1)', () => {
  const fake = (subjectId: string, kind: 'good' | 'bad') => ({ slot: `${subjectId.split('.')[0]}.${kind}.0`, area: subjectId.split('.')[0] as 'laning', kind, subjectId, index: null, factIds: [] });
  const dir = (subjectId: string, kind: 'good' | 'bad', text: string) => verifySlot(fake(subjectId, kind), { text, factIds: [] }, ctx).map((f) => f.rule);
  it('과목마다 반대 방향 단어가 있으면 실패, 맞는 방향은 통과', () => {
    for (const [id, w] of Object.entries(SUBJECT_DIRECTION_WORDS)) {
      assert.deepEqual(dir(id, 'bad', `상대보다 ${w.good[0]}습니다.`), ['direction'], `${id} bad "${w.good[0]}"`);
      assert.deepEqual(dir(id, 'good', `상대보다 ${w.bad[0]}습니다.`), ['direction'], `${id} good "${w.bad[0]}"`);
      assert.deepEqual(dir(id, 'good', `상대보다 ${w.good[0]}습니다.`), [], `${id} good "${w.good[0]}"`);
      assert.deepEqual(dir(id, 'bad', `상대보다 ${w.bad[0]}습니다.`), [], `${id} bad "${w.bad[0]}"`);
    }
  });
  it('리뷰 탐침: 부족한 점 칸에 "703 많았습니다"는 실패', () => {
    assert.deepEqual(rules('laning.bad.0', '15분 골드가 상대 애쉬보다 703 많았습니다.', GOLD), ['direction']);
  });
  it('데스가 주인공이 아닌 과목은 "데스가 많았" 구절을 빼고 본다, 단독 킬·데스는 데스 방향이 뒤집힌다', () => {
    assert.deepEqual(dir('laning.gold', 'bad', '그 전에 데스가 많았고 골드가 적었습니다.'), []);
    assert.deepEqual(dir('macro.solo', 'bad', '단독 데스가 많았습니다.'), []);
    assert.deepEqual(dir('macro.solo', 'good', '단독 데스가 많았습니다.'), ['direction']);
    assert.deepEqual(dir('macro.solo', 'good', '단독 데스가 적었습니다.'), []);
  });
});

describe('검사 2-2: 앞선 팀이 바뀐 결정적 장면 (Q1, 원딜 판 KR_8419447142 p4)', () => {
  const s = set5Sheet('KR_8419447142');
  const c = ctxOf(s);
  const r = (slotId: string, text: string, factIds: string[]) => verifySlot(s.slots.find((x) => x.slot === slotId)!, { text, factIds }, c);
  const KM0 = ['keyMoment.0.startMin', 'keyMoment.0.killsOurs', 'keyMoment.0.killsTheirs', 'keyMoment.0.swingAbs', 'keyMoment.0.leaderBefore', 'keyMoment.0.leaderAfter'];
  it('바뀜 + 우리 팀 손해 swingAbs는 통과 (어림 포함)', () => {
    assert.deepEqual(r('keyMoment.0', '23.6분 싸움에서 우리 팀 0킬, 상대 팀 3킬로 앞선 팀이 상대 팀으로 바뀌었고, 우리 팀은 골드 약 4,400 손해를 봤습니다.', KM0), []);
  });
  it('리뷰 문장 "300 벌어졌고 … 바뀌었습니다"는 방향·숫자·없는 fact로 실패', () => {
    const f = r('keyMoment.0', '23.6분 싸움에서 상대 팀만 3킬을 올리며 골드 격차가 300 벌어졌고, 앞선 팀이 상대 팀으로 바뀌었습니다.', [...KM0, 'keyMoment.0.gapChangeAbs']);
    assert.deepEqual([...new Set(f.map((x) => x.rule))].sort(), ['direction', 'number', 'shape']);
  });
  it('"좁혀졌습니다"(km2)·바뀜 말 없음·"이득"(실제 손해)은 실패', () => {
    const KM2 = ['keyMoment.2.startMin', 'keyMoment.2.swingAbs'];
    assert.ok(r('keyMoment.2', '16.6분 싸움 뒤 우리 팀이 앞서던 골드 격차가 3,618 좁혀졌습니다.', KM2).some((x) => x.rule === 'direction'));
    assert.deepEqual(r('keyMoment.2', '16.6분 싸움으로 우리 팀이 골드 3,618 손해를 봤습니다.', KM2).map((x) => x.rule), ['direction']);
    assert.deepEqual(r('keyMoment.2', '16.6분 싸움으로 앞선 팀이 바뀌었고 우리 팀이 골드 3,618 이득을 봤습니다.', KM2).map((x) => x.rule), ['direction']);
  });
  it('요약도 역전 장면이면 벌어/좁혀 금지', () => {
    const ids = s.slots.find((x) => x.slot === 'summary')!.factIds;
    const f = r('summary', '라인전은 열세였고, 오브젝트 싸움은 잘했고, 그 밖의 운영은 부족했습니다. 23.6분 싸움 뒤 골드 격차가 벌어졌습니다.', ids);
    assert.deepEqual(f.map((x) => x.rule), ['direction']);
  });
});
