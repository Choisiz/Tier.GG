// facts (ai_spec 2-4): 세나 판 값, 표기 규칙, 등급·점수 제외, 칸 구성
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { minuteDisplay, numberDisplay } from '../../../../src/analysis/llm/facts.js';
import { buildUserMessage, type UserPayload } from '../../../../src/analysis/llm/prompt.js';
import { senaSheet, set5Sheet } from './helpers.js';

const sheet = senaSheet();
const fact = (id: string) => {
  const f = sheet.byId.get(id);
  assert.ok(f, id);
  return f;
};

describe('facts: 표기 규칙', () => {
  it('정수는 쉼표 있는/없는 형태', () => {
    assert.deepEqual(numberDisplay(3895), ['3895', '3,895']);
    assert.deepEqual(numberDisplay(703), ['703']);
  });
  it('소수는 둘째 자리 원래 값 + 첫째 자리 반올림, 정수 반올림은 없음', () => {
    assert.deepEqual(numberDisplay(3.46), ['3.46', '3.5']);
    assert.deepEqual(numberDisplay(2.75), ['2.75', '2.8']);
    assert.deepEqual(numberDisplay(0.5), ['0.5']);
    assert.deepEqual(numberDisplay(0.96), ['0.96']); // 1.0(정수)로 반올림한 표기는 허용하지 않는다
  });
  it('초 → 분: 첫째 자리 반올림과 내림한 정수', () => {
    assert.deepEqual(minuteDisplay(904.8), ['15.1', '15']);
    assert.deepEqual(minuteDisplay(900), ['15']);
    assert.deepEqual(minuteDisplay(1000.4), ['16.7', '16']);
  });
});

describe('facts: 세나 판 값', () => {
  it('라인전: 15분, 골드 3,958:4,661 차이 703 (어림 100), 상대 애쉬', () => {
    assert.deepEqual(fact('laning.referenceMin').display, ['15']);
    assert.equal(fact('laning.gold.me').value, 3958);
    assert.equal(fact('laning.gold.enemy').value, 4661);
    assert.equal(fact('laning.gold.diffAbs').value, 703);
    assert.deepEqual(fact('laning.gold.diffAbs').approx, { step: 100 });
    assert.equal(fact('laning.opponent').value, '애쉬');
    assert.equal(fact('player.champion').value, '세나');
    assert.deepEqual(sheet.allowedNames, ['세나', '애쉬']);
  });
  it('KDA 세부와 기준 전 데스 2번', () => {
    assert.equal(fact('laning.kda.me').value, 1);
    assert.equal(fact('laning.kda.enemy').value, 5);
    assert.equal(fact('laning.kda.me.deaths').value, 2);
    assert.equal(fact('laning.deathsBefore.count').value, 2);
  });
  it('결정적 장면 0: 15.1분, 킬 5, 격차 변화 3,895, 상대 팀 우세에서 시작', () => {
    assert.deepEqual(fact('keyMoment.0.startMin').display, ['15.1', '15']);
    assert.equal(fact('keyMoment.0.kills').value, 5);
    assert.equal(fact('keyMoment.0.gapChangeAbs').value, 3895);
    assert.equal(fact('keyMoment.0.leaderBefore').value, '상대 팀');
    assert.equal(fact('keyMoment.2.gapChangeAbs').value, 465);
    assert.equal(fact('keyMoment.0.followUp.0').value, '우리 바텀 1차 포탑을 잃었습니다');
  });
  it('말할 과목의 숫자만 평평하게 (시야 0.5, 이득 4.5%, 사이드 분당 87.4)', () => {
    assert.equal(fact('fight.vision.perObjective').value, 0.5);
    assert.equal(fact('fight.advantage.sharePct').value, 4.5);
    assert.equal(fact('macro.side.perMinute').value, 87.4);
    // fight.damage는 C라 말하지 않는다 → facts에 없음
    assert.equal(sheet.byId.has('fight.damage.share1'), false);
  });
});

describe('facts: 등급·점수·반영 비율은 넣지 않는다', () => {
  it('id와 label에 grade·score·impact·weight·total이 없음', () => {
    for (const f of sheet.facts) {
      assert.doesNotMatch(f.id, /grade|score|impact|weight|total|\.ours$|\.theirs$|lastHitPoints/i, f.id);
      assert.doesNotMatch(f.label, /등급|총점|반영/, f.label);
    }
  });
  it('사용자 메시지에 등급 글자 필드·점수가 나오지 않음', () => {
    const msg = buildUserMessage(sheet);
    assert.doesNotMatch(msg, /"grade|"score|"impact|"weight|"total/);
  });
});

describe('facts: 칸 구성 (영역마다 좋은 점·부족한 점 최대 2개)', () => {
  it('세나 판 칸: 요약, 라인전 부족 2, 교전 부족 2, 운영 좋음 1·부족 2, 결정적 장면 3', () => {
    assert.deepEqual(
      sheet.slots.map((s) => `${s.slot}:${s.subjectId ?? s.index ?? ''}`),
      [
        'summary:',
        'laning.bad.0:laning.gold',
        'laning.bad.1:laning.kda',
        'fight.bad.0:fight.vision',
        'fight.bad.1:fight.advantage',
        'macro.good.0:macro.side',
        'macro.bad.0:macro.vision',
        'macro.bad.1:macro.advantage',
        'keyMoment.0:0',
        'keyMoment.1:1',
        'keyMoment.2:2',
      ],
    );
  });
  it('요약 칸은 1위 결정적 장면 fact를 쓸 수 있다', () => {
    const s = sheet.slots.find((x) => x.slot === 'summary')!;
    assert.ok(s.factIds.includes('keyMoment.0.gapChangeAbs'));
    assert.ok(!s.factIds.includes('keyMoment.1.gapChangeAbs'));
  });
});

describe('facts: 결정적 장면 우리 팀 기준 변화와 역전 (Q1)', () => {
  it('세나 판(역전 없음): swingAbs = gapChangeAbs, reversed 그대로, 우리 팀이 잃음', () => {
    assert.equal(fact('keyMoment.0.swingAbs').value, 3895);
    assert.deepEqual(fact('keyMoment.0.swingAbs').approx, { step: 100 });
    assert.equal(fact('keyMoment.0.swingSide').value, '우리 팀이 잃음');
    assert.equal(fact('keyMoment.0.reversed').value, '그대로');
  });
  it('원딜 판 KR_8419447142 p4: 역전 장면 0·2는 swingAbs·바뀜만 있고 gapChangeAbs가 없다', () => {
    const s = set5Sheet('KR_8419447142');
    const f = (id: string) => s.byId.get(id);
    assert.equal(f('keyMoment.0.swingAbs')?.value, 4376);
    assert.equal(f('keyMoment.0.swingSide')?.value, '우리 팀이 잃음');
    assert.equal(f('keyMoment.0.reversed')?.value, '바뀜');
    assert.equal(f('keyMoment.0.gapChangeAbs'), undefined);
    assert.equal(f('keyMoment.2.swingAbs')?.value, 3618);
    assert.equal(f('keyMoment.2.gapChangeAbs'), undefined);
    // 역전이 아닌 장면 1은 그대로
    assert.equal(f('keyMoment.1.reversed')?.value, '그대로');
    assert.ok(f('keyMoment.1.gapChangeAbs'));
    const km0Slot = s.slots.find((x) => x.slot === 'keyMoment.0')!;
    assert.ok(km0Slot.factIds.includes('keyMoment.0.swingAbs'));
  });
  it('사용자 메시지: 역전 장면 direction은 "앞선 팀이 바뀜", 숫자 fact에 허용 단위어(units)', () => {
    const s = set5Sheet('KR_8419447142');
    const msg = JSON.parse(buildUserMessage(s)) as UserPayload;
    assert.deepEqual(msg.keyMoments.map((k) => k.direction), ['앞선 팀이 바뀜', '벌어짐', '앞선 팀이 바뀜']);
    assert.equal(msg.keyMoments[0]!.swingSide, '우리 팀이 잃음');
    assert.deepEqual(msg.facts.find((x) => x.id === 'keyMoment.1.killsTheirs')!.units, ['킬', '개', '번']);
    assert.equal(msg.facts.find((x) => x.id === 'laning.kda.me')?.units, undefined);
  });
});
