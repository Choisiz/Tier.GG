// 세나 판 KR_8437852704 재현 (ai_spec B-3 "세나 판 재현", feedback_design 9장)
// 딜은 반올림 전 비중으로 판정 (사용자 결정 2026-11-02). 설계 9장도 이 값으로 고쳤다.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeMatch } from '../../../src/analysis/index.js';
import type { AnalysisResult, SubjectResult } from '../../../src/analysis/types.js';
import { loadSena, puuidOf, TAGS } from './helpers.js';

const { match, timeline } = loadSena();
const r: AnalysisResult = analyzeMatch({ match, timeline, puuid: puuidOf(5), championTags: TAGS });
const subject = (area: 'fight' | 'macro', id: string): SubjectResult => {
  const s = r[area].subjects.find((x) => x.id === id);
  assert.ok(s, id);
  return s;
};

describe('세나 판: 기본 정보', () => {
  it('세나(235) 서폿 = 딜서폿, 23분 패배', () => {
    assert.deepEqual(r.player, {
      participantId: 5,
      championId: 235,
      position: 'UTILITY',
      role: 'SUPPORT_DAMAGE',
      win: false,
      durationSec: 1385,
    });
    assert.deepEqual(r.warnings, []);
  });
});

describe('세나 판: 라인전 (9장)', () => {
  it('기준 15분 (바텀 1차 포탑 15.9분보다 빠름), 상대 애쉬', () => {
    assert.ok(r.laning);
    assert.equal(r.laning.referenceSec, 900);
    assert.equal(r.laning.referenceReason, 'DEFAULT_15');
    assert.equal(Math.round(r.laning.laneTurretSec! / 6) / 10, 15.9);
    assert.deepEqual(r.laning.opponent, { participantId: 10, championId: 22 });
  });
  it('골드 3,958:4,661(−1), 레벨 8:8(0), (K+A)−D 1:5(−1) → 합 −2 열세', () => {
    const items = Object.fromEntries(r.laning!.items.map((x) => [x.id, x]));
    assert.deepEqual([items['laning.gold']!.me, items['laning.gold']!.enemy, items['laning.gold']!.point], [3958, 4661, -1]);
    assert.equal(items['laning.gold']!.diff, -703);
    assert.deepEqual([items['laning.level']!.me, items['laning.level']!.enemy, items['laning.level']!.point], [8, 8, 0]);
    assert.deepEqual([items['laning.kda']!.me, items['laning.kda']!.enemy, items['laning.kda']!.point], [1, 5, -1]);
    assert.deepEqual(items['laning.kda']!.detail, { formula: '(K+A)-D', me: [0, 2, 3], enemy: [2, 1, 4] });
    assert.equal(items['laning.cs'], undefined, '서폿은 CS 보조 지표 없음');
    assert.equal(r.laning!.sum, -2);
    assert.equal(r.laning!.verdict, '열세');
  });
  it('15분 전 두 번 잡힘 (2.5분, 8.5분)', () => {
    assert.deepEqual(
      r.laning!.deathsBeforeReferenceSec.map((s) => Math.round(s / 6) / 10),
      [2.5, 8.5],
    );
  });
});

describe('세나 판: 교전 (9장, 딜서폿 이득 5 · 딜 60 · 시야 30 · 오브젝트 5)', () => {
  it('반영 비율', () => {
    assert.deepEqual(r.fight.weights, { advantage: 5, damage: 60, vision: 30, objective: 5 });
  });
  it('이득 여부 E: 오브젝트 싸움 2번, 5 ÷ (5 + 105) = 4.5%', () => {
    const s = subject('fight', 'fight.advantage');
    assert.deepEqual(s.facts, { fights: 2, ours: 5, theirs: 105, sharePct: 4.5 });
    assert.equal(s.grade, 'E');
    assert.equal(s.score, 0);
  });
  it('시야 E: 오브젝트 4개에 2점 → 1개당 0.5', () => {
    const s = subject('fight', 'fight.vision');
    assert.deepEqual(s.facts, { objectives: 4, points: 2, perObjective: 0.5 });
    assert.equal(s.grade, 'E');
    assert.equal(s.score, 0);
  });
  it('오브젝트 C: 막타 0 (정글 외 기본)', () => {
    const s = subject('fight', 'fight.objective');
    assert.equal(s.facts.lastHits, 0);
    assert.equal(s.grade, 'C');
    assert.equal(s.score, 2.5);
  });
  it('딜 비중: 0~15분 약 15% (기대 18), 15분~ 약 13% (기대 16)', () => {
    const s = subject('fight', 'fight.damage');
    assert.equal(Math.round(s.facts.share0 as number), 15);
    assert.equal(s.facts.expected0, 18);
    assert.equal(Math.round(s.facts.share1 as number), 13);
    assert.equal(s.facts.expected1, 16);
    assert.equal(s.facts.share2, undefined, '30분 이후 구간 없음');
  });
  it('딜 C (22.5점): 0~15분 15.25% (−2.75%p → C), 15분~ 12.54% (−3.46%p → D), 평균 37.5%', () => {
    const s = subject('fight', 'fight.damage');
    assert.deepEqual([s.facts.share0, s.facts.diff0, s.facts.grade0], [15.25, -2.75, 'C']);
    assert.deepEqual([s.facts.share1, s.facts.diff1, s.facts.grade1], [12.54, -3.46, 'D']);
    assert.equal(s.gradePoint, 0.375);
    assert.equal(s.grade, 'C');
    assert.equal(s.score, 22.5);
  });
  it('교전 총점 25', () => {
    assert.equal(r.fight.total, 25);
  });
  it('교전 판정 부족 (총점 40 미만)', () => {
    assert.ok(r.fight.total !== null && r.fight.total < 40);
    assert.equal(r.fight.verdict, '부족');
  });
  it('말할 순서: 좋은 점 없음, 부족한 점 시야 → 이득 여부 (딜 C는 말하지 않음)', () => {
    assert.deepEqual(r.speakOrder.fight, { good: [], bad: ['fight.vision', 'fight.advantage'] });
  });
});

describe('세나 판: 운영 (9장, 딜서폿 운영 이득 30 · 단독 25 · 사이드 5 · 평소 시야 40)', () => {
  it('운영 이득 E: 51 ÷ (51 + 150) = 25%', () => {
    const s = subject('macro', 'macro.advantage');
    assert.equal(s.facts.ours, 51);
    assert.equal(s.facts.theirs, 150);
    assert.equal(Math.round(s.facts.sharePct as number), 25);
    assert.equal(s.grade, 'E');
  });
  it('단독 킬·데스 C (0)', () => {
    const s = subject('macro', 'macro.solo');
    assert.equal(s.facts.net, 0);
    assert.equal(s.grade, 'C');
    assert.equal(s.score, 12.5);
  });
  it('사이드 압박 B: 분당 포탑 피해 87', () => {
    const s = subject('macro', 'macro.side');
    assert.equal(Math.round(s.facts.perMinute as number), 87);
    assert.equal(s.grade, 'B');
    assert.equal(s.score, 3.75);
  });
  it('중후반 파밍: 서폿은 매기지 않음 (반영 비율 0)', () => {
    const s = subject('macro', 'macro.farm');
    assert.equal(s.grade, null);
    assert.equal(s.weight, 0);
  });
  it('평소 시야 E: 분당 0.91', () => {
    const s = subject('macro', 'macro.vision');
    assert.equal(s.facts.perMinute, 0.91);
    assert.equal(s.grade, 'E');
  });
  it('운영 총점 16.25 → 부족', () => {
    assert.equal(r.macro.total, 16.25);
    assert.equal(r.macro.verdict, '부족');
  });
  it('말할 순서: 좋은 점 사이드 압박, 부족한 점 평소 시야 → 운영 이득', () => {
    assert.deepEqual(r.speakOrder.macro, { good: ['macro.side'], bad: ['macro.vision', 'macro.advantage'] });
  });
});

describe('세나 판: 결정적 장면 (2-1)', () => {
  it('3개: +3,895 / +3,887 / −465 순', () => {
    assert.equal(r.keyMoments.length, 3);
    assert.deepEqual(
      r.keyMoments.map((k) => k.gapChange),
      [3895, 3887, -465],
    );
    assert.deepEqual(
      r.keyMoments.map((k) => k.direction),
      ['widened', 'widened', 'narrowed'],
    );
  });
  it('① 15.1~15.9분 킬 5개, 세나 사망, 3,324 → 7,219 (상대 우세), 직후 바텀 1차 포탑', () => {
    const k = r.keyMoments[0]!;
    assert.equal(Math.round(k.startSec / 6) / 10, 15.1);
    assert.equal(Math.round(k.endSec / 6) / 10, 15.9);
    assert.equal(k.kills, 5);
    assert.equal(k.playerDied, true);
    assert.deepEqual([k.goldDiffBefore, k.goldDiffAfter], [-3324, -7219]);
    assert.ok(k.followUps.some((f) => f.what === 'TOWER_BUILDING:BOT_LANE:OUTER_TURRET' && !f.ours));
  });
  it('② 16.7분 킬 3개, 5,644 → 9,531, 전령으로 이어짐', () => {
    const k = r.keyMoments[1]!;
    assert.equal(Math.round(k.startSec / 6) / 10, 16.7);
    assert.equal(k.kills, 3);
    assert.deepEqual([k.goldDiffBefore, k.goldDiffAfter], [-5644, -9531]);
    assert.ok(k.followUps.some((f) => f.kind === 'MONSTER' && f.what === 'RIFTHERALD'));
  });
  it('③ 22.2~22.9분 킬 8개(4:4), 세나 사망, 12,582 → 12,117, 억제기·넥서스 포탑 잃음', () => {
    const k = r.keyMoments[2]!;
    assert.equal(Math.round(k.startSec / 6) / 10, 22.2);
    assert.equal(Math.round(k.endSec / 6) / 10, 22.9);
    assert.equal(k.kills, 8);
    assert.deepEqual([k.killsOurs, k.killsTheirs], [4, 4]);
    assert.equal(k.playerDied, true);
    assert.deepEqual([k.goldDiffBefore, k.goldDiffAfter], [-12582, -12117]);
    assert.equal(k.selectedBy, 'KILLS');
    assert.ok(k.followUps.some((f) => f.what.startsWith('INHIBITOR_BUILDING')));
  });
});

describe('세나 판: 요약 (2-2)', () => {
  it('라인전 열세 · 교전 부족 · 운영 부족, 결정적 장면 1위', () => {
    assert.deepEqual(r.summary, { laning: '열세', fight: '부족', macro: '부족', keyMomentIndex: 0 });
  });
  it('라인전 말할 순서: 부족한 점 골드 → KDA', () => {
    assert.deepEqual(r.speakOrder.laning, { good: [], bad: ['laning.gold', 'laning.kda'] });
  });
  it('첫 데스 해석은 점수 밖 노트로만', () => {
    assert.ok(r.notes.every((n) => n.kind === 'interpretation' && n.id === 'fight.firstDeath'));
  });
});
