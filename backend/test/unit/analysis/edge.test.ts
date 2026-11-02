// 경계 사례 (가짜 timeline, ai_spec B-3 "경계 사례")
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreObjectives } from '../../../src/analysis/fights.js';
import { AnalysisError, analyzeMatch } from '../../../src/analysis/index.js';
import type { AnalysisResult, SubjectResult, TimelineEvent } from '../../../src/analysis/types.js';
import { fakeGame, kill, monster, puuidOf, TAGS, turret, ward, type FakeOptions } from './helpers.js';

const run = (pid: number, o: FakeOptions = {}): AnalysisResult => {
  const { match, timeline } = fakeGame(o);
  return analyzeMatch({ match, timeline, puuid: puuidOf(pid), championTags: TAGS });
};
const subj = (r: AnalysisResult, id: string): SubjectResult => {
  const s = [...r.fight.subjects, ...r.macro.subjects].find((x) => x.id === id);
  assert.ok(s, id);
  return s;
};

describe('라인전 기준 시점', () => {
  it('정글은 포탑과 관계없이 15분 고정, 탑은 12분 탑 포탑으로 12분', () => {
    const events = [turret(12, 200, 'TOP_LANE')];
    const jg = run(2, { events });
    assert.equal(jg.laning!.referenceSec, 900);
    assert.equal(jg.laning!.referenceReason, 'JUNGLE_15');
    const top = run(1, { events });
    assert.equal(top.laning!.referenceSec, 720);
    assert.equal(top.laning!.referenceReason, 'TURRET');
  });
  it('10분 전 바텀 포탑 파괴 → 원딜·서폿 모두 10분 (최소 10분)', () => {
    const events = [turret(8, 100, 'BOT_LANE')];
    for (const pid of [4, 5, 9, 10]) {
      const r = run(pid, { events });
      assert.equal(r.laning!.referenceSec, 600, `pid ${pid}`);
      assert.equal(r.laning!.referenceReason, 'MIN_10');
    }
  });
  it('12.5분 미드 포탑 → 기준 750초, 그 전 정각(12분) 스냅샷 값을 쓴다', () => {
    const r = run(3, {
      events: [turret(12.5, 200, 'MID_LANE')],
      frame: (i, pid) => ({ totalGold: pid === 3 ? 1000 + i : 1000, level: 5, minionsKilled: pid === 3 ? 50 : 60 }),
    });
    assert.equal(r.laning!.referenceSec, 750);
    const gold = r.laning!.items.find((x) => x.id === 'laning.gold')!;
    assert.deepEqual([gold.me, gold.enemy, gold.point], [1012, 1000, 1]);
    // 미드는 CS 보조 지표 포함
    const csItem = r.laning!.items.find((x) => x.id === 'laning.cs')!;
    assert.deepEqual([csItem.me, csItem.enemy, csItem.point], [50, 60, -1]);
    assert.equal(r.laning!.sum, 0);
    assert.equal(r.laning!.verdict, '비슷');
  });
  it('같은 포지션 상대가 0명·2명이면 라인전 판정 불가 (나머지는 계속)', () => {
    const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'TOP', 'TOP', 'JUNGLE', 'BOTTOM', 'UTILITY'];
    const mid = run(3, { positions });
    assert.equal(mid.laning, null);
    assert.equal(mid.laningUnavailableReason, '같은 포지션 상대가 0명');
    assert.equal(mid.summary.laning, null);
    assert.deepEqual(mid.speakOrder.laning, { good: [], bad: [] });
    const top = run(1, { positions });
    assert.equal(top.laningUnavailableReason, '같은 포지션 상대가 2명');
    assert.ok(top.macro.total !== null);
  });
  it('15분 미만 게임(13분 20초): 13분 스냅샷으로 줄임, 딜은 0~13분 한 구간, 중후반 파밍 없음', () => {
    const r = run(1, { durationSec: 800 });
    assert.equal(r.laning!.referenceSec, 780);
    assert.equal(r.laning!.referenceReason, 'GAME_END');
    const dmg = subj(r, 'fight.damage');
    assert.ok(dmg.facts.share0 !== undefined);
    assert.equal(dmg.facts.share1, undefined);
    assert.equal(subj(r, 'macro.farm').reason, '20분 미만 게임');
  });
  it('10분 전에 끝난 게임은 라인전 판정 불가', () => {
    const r = run(1, { durationSec: 570 });
    assert.equal(r.laning, null);
    assert.equal(r.laningUnavailableReason, '10분 스냅샷 전에 게임이 끝남');
  });
});

describe('교전 과목', () => {
  it('딜 구간이 3분 미만이면 그 구간은 판정하지 않음 (17분 30초 게임 → 15~17.5분 제외)', () => {
    const r = run(1, { durationSec: 1050 });
    const dmg = subj(r, 'fight.damage');
    assert.ok(dmg.facts.share0 !== undefined);
    assert.equal(dmg.facts.share1, undefined);
  });
  it('딜 비중 = 구간 팀 내 비중 − 기대 비중 (딜탑 0~15분 기대 22)', () => {
    // 모두 같은 딜이면 20% → 22와 −2%p → C
    const r = run(1);
    assert.equal(subj(r, 'fight.damage').facts.share0, 20);
    assert.equal(subj(r, 'fight.damage').facts.diff0, -2);
    assert.equal(subj(r, 'fight.damage').facts.grade0, 'C');
  });
  it('오브젝트 싸움에 한 번도 안 끼면 이득 여부를 빼고 100점 환산', () => {
    const r = run(1, { events: [monster(10, 7, 'DRAGON', 'FIRE_DRAGON'), kill(10.2, 7, 2)] });
    const adv = subj(r, 'fight.advantage');
    assert.equal(adv.grade, null);
    assert.equal(adv.reason, '오브젝트 싸움에 한 번도 끼지 않음');
    // 딜탑: 딜 60 · 시야 5 · 오브젝트 5만 남음
    const graded = r.fight.subjects.filter((s) => s.grade !== null);
    const expected = (graded.reduce((s, x) => s + x.weight * x.gradePoint!, 0) / 70) * 100;
    assert.equal(r.fight.total, Math.round(expected * 100) / 100);
  });
  it('오브젝트 싸움에 끼면 그 창의 득실로 이득 여부 (내 팀 몫)', () => {
    // 10분 용(상대) 창 안: 내가 상대 미드를 잡음(우리 7), 상대가 용(10) + 우리 정글을 잡음(5)
    const r = run(1, { events: [monster(10, 7, 'DRAGON', 'FIRE_DRAGON'), kill(9.8, 1, 8), kill(10.1, 7, 2)] });
    const adv = subj(r, 'fight.advantage');
    assert.deepEqual(adv.facts, { fights: 1, ours: 7, theirs: 15, sharePct: 31.8 });
    assert.equal(adv.grade, 'D');
  });
  it('오브젝트가 한 번도 안 나온 판: 이득·시야·오브젝트를 빼고 딜만으로 총점', () => {
    const r = run(1, { events: [kill(5, 1, 6)] });
    for (const id of ['fight.advantage', 'fight.vision', 'fight.objective']) assert.equal(subj(r, id).grade, null, id);
    const dmg = subj(r, 'fight.damage');
    assert.equal(r.fight.total, Math.round(dmg.gradePoint! * 10000) / 100);
  });
  it('영혼 용(팀의 4번째 용) 50, 장로용 80: 정글 막타 160 → A, 4번째까지만이면 80 → B', () => {
    const dragons: TimelineEvent[] = [
      monster(6, 2, 'DRAGON', 'FIRE_DRAGON'),
      monster(11, 7, 'DRAGON', 'AIR_DRAGON'), // 상대 팀 용은 우리 팀 개수에 안 셈
      monster(12, 2, 'DRAGON', 'WATER_DRAGON'),
      { type: 'DRAGON_SOUL_GIVEN', timestamp: 12 * 60_000 + 500, teamId: 0 }, // 영혼 속성 공개 이벤트
      monster(18, 2, 'DRAGON', 'HEXTECH_DRAGON'),
      monster(24, 2, 'DRAGON', 'HEXTECH_DRAGON'),
    ];
    const four = run(2, { events: dragons });
    assert.equal(subj(four, 'fight.objective').facts.lastHitPoints, 80);
    assert.deepEqual(subj(four, 'fight.objective').facts.lastHitKinds, ['DRAGON', 'DRAGON', 'DRAGON', 'SOUL_DRAGON']);
    assert.equal(subj(four, 'fight.objective').grade, 'B');
    const elder = run(2, { events: [...dragons, monster(29, 2, 'DRAGON', 'ELDER_DRAGON')] });
    assert.equal(subj(elder, 'fight.objective').facts.lastHitPoints, 160);
    assert.equal(subj(elder, 'fight.objective').grade, 'A');
  });
  it('점수: 바론 50, 전령 10, 유충 4, 표에 없는 몬스터는 제외하고 경고', () => {
    const warnings: string[] = [];
    const objs = scoreObjectives(
      [monster(8, 2, 'HORDE'), monster(14, 2, 'RIFTHERALD'), monster(21, 2, 'BARON_NASHOR'), monster(22, 2, 'ATAKHAN')],
      warnings,
    );
    assert.deepEqual(
      objs.map((o) => [o.kind, o.points]),
      [
        ['HORDE', 4],
        ['RIFTHERALD', 10],
        ['BARON', 50],
      ],
    );
    assert.deepEqual(warnings, ['점수표에 없는 몬스터는 제외: ATAKHAN']);
  });
  it('정글 외: 막타 1번 이상이면 오브젝트 A, 없으면 C', () => {
    const events = [monster(10, 1, 'RIFTHERALD'), monster(15, 2, 'DRAGON', 'FIRE_DRAGON')];
    assert.equal(subj(run(1, { events }), 'fight.objective').grade, 'A');
    assert.equal(subj(run(3, { events }), 'fight.objective').grade, 'C');
  });
  it('시야: 오브젝트 직전 60초 안의 와드만 (61초 전은 운영 평소 시야로)', () => {
    const events = [
      monster(10, 2, 'DRAGON', 'FIRE_DRAGON'),
      ward(9.5, 5, 'CONTROL_WARD'), // 30초 전: 3점
      { type: 'WARD_KILL', timestamp: 9.2 * 60_000, killerId: 5, wardType: 'SIGHT_WARD' } as TimelineEvent, // 48초 전: 2점
      ward(8.98, 5, 'YELLOW_TRINKET'), // 61.2초 전: 평소 시야
      ward(9.9, 5, 'UNDEFINED'), // 점수 없음
    ];
    const r = run(5, { events });
    assert.deepEqual(subj(r, 'fight.vision').facts, { objectives: 1, points: 5, perObjective: 5 });
    assert.equal(subj(r, 'fight.vision').grade, 'A');
    assert.equal(subj(r, 'macro.vision').facts.points, 1);
  });
});

describe('운영 과목', () => {
  it('단독 킬·데스: 오브젝트 창 밖 1킬 싸움만 센다', () => {
    const events = [
      kill(3, 1, 6), // 단독 킬 +1
      kill(6, 6, 1), // 단독 데스 −1
      kill(9, 1, 6), // 단독 킬 +1
      kill(12, 1, 6), // 12분 용 창 안 → 제외
      monster(12.3, 2, 'DRAGON', 'FIRE_DRAGON'),
      kill(20, 1, 6),
      kill(20.2, 1, 7), // 2킬 싸움 → 제외
    ];
    const s = subj(run(1, { events }), 'macro.solo');
    assert.deepEqual(s.facts, { kills: 2, deaths: 1, net: 1 });
    assert.equal(s.grade, 'B');
  });
  it('운영 이득: 창 밖 싸움의 킬 + 60초 안 포탑, 오브젝트 창 안 포탑은 제외', () => {
    const events = [
      kill(5, 1, 6), // 우리 +5 (탑)
      turret(5.5, 200, 'TOP_LANE'), // 우리 +10 (60초 안)
      kill(14, 6, 1), // 상대 +5
      turret(15.5, 100, 'TOP_LANE'), // 14분 싸움 끝 60초 넘음 → 제외
    ];
    const s = subj(run(1, { events }), 'macro.advantage');
    assert.deepEqual(s.facts, { fights: 2, ours: 15, theirs: 5, sharePct: 75 });
    assert.equal(s.grade, 'A');
  });
  it('중후반 파밍: 15분 이후 분당 CS (실제 경과 분), 20분 이상 게임만', () => {
    // 분당 7 CS, 30분 게임 → 15→30분 105 CS / 15분 = 7.0 → 딜탑 C(6.1~7.1)
    const s = subj(run(1), 'macro.farm');
    assert.equal(s.facts.perMinute, 7);
    assert.equal(s.grade, 'C');
  });
  it('사이드 압박: 분당 포탑 피해', () => {
    const s = subj(run(1, { turretDamage: (pid) => (pid === 1 ? 9000 : 0) }), 'macro.side');
    assert.equal(s.facts.perMinute, 300);
    assert.equal(s.grade, 'C');
    assert.equal(subj(run(5), 'macro.side').grade, null, '탱서폿은 사이드 압박 비율 0');
  });
});

describe('결정적 장면 (2-1)', () => {
  // 100팀 기준 팀 골드 차 D(분)
  const D = (i: number) =>
    i < 7 ? 0 : i < 12 ? 3000 : i < 17 ? 3100 : i < 21 ? 3000 : i < 25 ? 5999 : i < 26 ? 6000 : 2000;
  const frame = (i: number, pid: number) => ({ totalGold: pid === 1 ? 1000 + D(i) : 1000, level: 5 });
  const burst = (start: number, n: number) => Array.from({ length: n }, (_, k) => kill(start + k * 0.05, 1, 6));
  const events = [
    kill(5.1, 1, 6),
    kill(5.6, 1, 6), // 5분에 시작한 두 싸움 → 합침: 0 → 3,000 (정확히 3,000)
    ...burst(10, 5), // 킬 5, 격차 +100
    ...burst(15, 6), // 킬 6, 격차 −100
    kill(20, 1, 6), // 격차 +2,999 → 안 고름
    kill(25, 6, 1), // 6,000 → 2,000 (−4,000, 좁혀짐)
  ];
  const r = run(1, { events, frame });
  it('격차 조건 후보를 격차 큰 순 → 남은 자리는 킬 조건 후보를 킬 많은 순, 최대 3개', () => {
    assert.deepEqual(
      r.keyMoments.map((k) => [Math.round(k.startSec / 6) / 10, k.kills, k.swing, k.selectedBy]),
      [
        [25, 1, -4000, 'GOLD'],
        [5.1, 2, 3000, 'GOLD'],
        [15, 6, -100, 'KILLS'],
      ],
    );
  });
  it('같은 분에 시작한 싸움은 하나로 합친다', () => {
    const k = r.keyMoments[1]!;
    assert.equal(Math.round(k.endSec / 6) / 10, 5.6);
    assert.deepEqual([k.goldDiffBefore, k.goldDiffAfter], [0, 3000]);
  });
  it('좁혀짐/벌어짐: |뒤| < |앞|이면 좁혀짐', () => {
    assert.equal(r.keyMoments[0]!.direction, 'narrowed');
    assert.equal(r.keyMoments[0]!.gapChange, -4000);
    assert.equal(r.keyMoments[1]!.direction, 'widened');
    assert.equal(r.summary.keyMomentIndex, 0);
  });
  it('조건에 맞는 싸움이 없으면 빈 목록, 요약 장면 null', () => {
    const q = run(1, { events: [kill(5, 1, 6)] });
    assert.deepEqual(q.keyMoments, []);
    assert.equal(q.summary.keyMomentIndex, null);
  });
});

describe('입력 오류', () => {
  it('그 판의 참가자가 아니면 PLAYER_NOT_FOUND', () => {
    const { match, timeline } = fakeGame();
    assert.throws(
      () => analyzeMatch({ match, timeline, puuid: 'nobody', championTags: TAGS }),
      (e: unknown) => e instanceof AnalysisError && e.code === 'PLAYER_NOT_FOUND',
    );
  });
  it('포지션 없는 판(칼바람 등)은 NO_POSITION', () => {
    const { match, timeline } = fakeGame({ positions: Array(10).fill('') });
    assert.throws(
      () => analyzeMatch({ match, timeline, puuid: puuidOf(1), championTags: TAGS }),
      (e: unknown) => e instanceof AnalysisError && e.code === 'NO_POSITION',
    );
  });
  it('match와 timeline의 matchId가 다르면 MATCH_MISMATCH', () => {
    const { match, timeline } = fakeGame();
    timeline.metadata = { matchId: 'KR_2' };
    assert.throws(
      () => analyzeMatch({ match, timeline, puuid: puuidOf(1), championTags: TAGS }),
      (e: unknown) => e instanceof AnalysisError && e.code === 'MATCH_MISMATCH',
    );
  });
  it('participantFrames가 없는 timeline도 오류 없이 돌고 경고를 남김', () => {
    const r = run(1, { noFrames: true, events: [kill(5, 1, 6)] });
    assert.equal(r.laning, null);
    assert.equal(subj(r, 'fight.damage').grade, null);
    assert.deepEqual(r.keyMoments, []);
    assert.equal(r.warnings.length, 1);
  });
});
