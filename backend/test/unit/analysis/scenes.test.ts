// 장면 정보 (ai_spec Q2): 판정 불변 + 지역(진영별) + 오브젝트 60초 창 와드 수 + 싸움별 득실
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { analyzeMatch, ENGINE_VERSION } from '../../../src/analysis/index.js';
import { regionOf, SCENES_MAX } from '../../../src/analysis/scenes.js';
import type { TimelineEvent } from '../../../src/analysis/types.js';
import { allSnapshots, SNAPSHOT_PATH, snapshotGames, type EngineSnapshot } from './engineSnapshot.js';
import { fakeGame, kill, monster, puuidOf, TAGS, ward } from './helpers.js';

describe('판정 불변 (Q2: 장면을 더해도 등급·점수·말할 과목이 그대로)', () => {
  const stored = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as { engineVersion: string; games: Record<string, EngineSnapshot> };
  const now = allSnapshots();
  it('스냅숏은 Q2 전 엔진(2026-11-02.2)에서 만든 것이고 지금 엔진 버전은 올라갔다', () => {
    assert.equal(stored.engineVersion, '2026-11-02.2');
    assert.equal(ENGINE_VERSION, '2026-11-10.1');
  });
  it('세나 판 + set5 4판, 판마다 10명 = 50명 모두 판정 해시·등급·총점·말할 과목·요약이 같다', () => {
    assert.equal(Object.keys(stored.games).length, 50);
    assert.deepEqual(Object.keys(now).sort(), Object.keys(stored.games).sort());
    for (const [k, v] of Object.entries(stored.games)) assert.deepEqual(now[k], v, k);
  });
});

describe('지역 판정 (진영별)', () => {
  const cases: [x: number, y: number, blue: string, red: string][] = [
    [500, 500, 'OUR_BASE', 'ENEMY_BASE'],
    [14_300, 14_300, 'ENEMY_BASE', 'OUR_BASE'],
    [1_000, 8_000, 'TOP_LANE_OURS', 'TOP_LANE_THEIRS'],
    [8_000, 13_800, 'TOP_LANE_THEIRS', 'TOP_LANE_OURS'],
    [8_000, 1_000, 'BOT_LANE_OURS', 'BOT_LANE_THEIRS'],
    [13_900, 9_000, 'BOT_LANE_THEIRS', 'BOT_LANE_OURS'],
    [7_000, 7_300, 'MID_LANE_OURS', 'MID_LANE_THEIRS'],
    [8_200, 7_900, 'MID_LANE_THEIRS', 'MID_LANE_OURS'],
    [9_859, 4_375, 'RIVER_BOT', 'RIVER_BOT'], // 실제 용 처치 좌표
    [5_007, 10_471, 'RIVER_TOP', 'RIVER_TOP'], // 바론 둥지 근처
    [3_500, 7_500, 'OUR_JUNGLE_TOP', 'ENEMY_JUNGLE_TOP'],
    [7_500, 3_500, 'OUR_JUNGLE_BOT', 'ENEMY_JUNGLE_BOT'],
    [7_000, 11_000, 'ENEMY_JUNGLE_TOP', 'OUR_JUNGLE_TOP'],
    [11_000, 7_000, 'ENEMY_JUNGLE_BOT', 'OUR_JUNGLE_BOT'],
  ];
  for (const [x, y, blue, red] of cases) {
    it(`(${x}, ${y}) → 블루 ${blue} / 레드 ${red}`, () => {
      assert.equal(regionOf({ x, y }, 100), blue);
      assert.equal(regionOf({ x, y }, 200), red);
    });
  }
  it('좌표가 없으면 null', () => {
    assert.equal(regionOf(undefined, 100), null);
  });
});

const at = (e: TimelineEvent, x: number, y: number): TimelineEvent => ({ ...e, position: { x, y } });
const wardKill = (min: number, killerId: number): TimelineEvent => ({ type: 'WARD_KILL', timestamp: Math.round(min * 60_000), killerId });

describe('오브젝트 60초 창의 와드 수 (교전 시야 장면)', () => {
  // 나 = 5(쓰레쉬, 블루 서폿). 용 10분(상대 7번이 잡음), 용 20분(우리 2번이 잡음)
  const events = [
    monster(10, 7, 'DRAGON', 'FIRE_DRAGON'),
    monster(20, 2, 'DRAGON', 'WATER_DRAGON'),
    ward(9.1, 5, 'CONTROL_WARD'), // 10분 용 전 60초 안
    ward(9.5, 5, 'YELLOW_TRINKET'), // 안
    ward(8.9, 5, 'SIGHT_WARD'), // 66초 전 → 밖
    ward(9.6, 5, 'UNDEFINED'), // 시야 점수 없는 와드 → 안 셈
    ward(9.7, 4, 'SIGHT_WARD'), // 다른 사람
    wardKill(9.8, 5), // 안
    ward(19.5, 5, 'SIGHT_WARD'),
    ward(19.6, 5, 'SIGHT_WARD'),
    ward(19.7, 5, 'SIGHT_WARD'),
  ];
  const { match, timeline } = fakeGame({ events });
  const r = analyzeMatch({ match, timeline, puuid: puuidOf(5), championTags: TAGS });
  const byMin = (m: number) => r.scenes.fightVision.find((s) => s.sec === m * 60)!;
  it('창(처치 전 60초) 안의 내 와드·제어 와드·와드 제거만 센다', () => {
    assert.deepEqual(
      { ...byMin(10) },
      { sec: 600, kind: 'DRAGON', ours: false, lastHitByMe: false, wardsPlaced: 2, controlWards: 1, wardKills: 1 },
    );
    assert.equal(byMin(20).wardsPlaced, 3);
    assert.equal(byMin(20).ours, true);
  });
  it('말하는 방향에 따라 순서: 부족한 점이면 내 시야가 적은 오브젝트 먼저, 좋은 점이면 많은 것 먼저', () => {
    const vision = r.fight.subjects.find((s) => s.id === 'fight.vision')!;
    const good = r.speakOrder.fight.good.includes('fight.vision');
    // 10분: 와드 2 + 제어 1 + 제거 1 → 1+2*1+2*1 = 5, 20분: 3
    assert.deepEqual(
      r.scenes.fightVision.map((s) => s.sec),
      good ? [600, 1200] : [1200, 600],
      `grade ${vision.grade}`,
    );
  });
  it('기준 시간: 오브젝트 싸움 40초, 시야 60초', () => {
    assert.equal(r.scenes.fightWindowSec, 40);
    assert.equal(r.scenes.visionWindowSec, 60);
  });
});

describe('싸움별 득실·먼저 죽은 사람·지역 (교전·운영 득실 장면)', () => {
  // 나 = 3(럭스, 블루 미드)
  const events = [
    // 오브젝트 싸움: 용 15분(상대가 잡음). 그 앞 14.5분 내가 먼저 죽고(상대 7·8), 14.7분 우리가 1킬
    monster(15, 7, 'DRAGON', 'FIRE_DRAGON'),
    at(kill(14.5, 8, 3, [7]), 9_800, 4_400),
    at(kill(14.7, 4, 9), 9_900, 4_500),
    // 내가 참여하지 않은 오브젝트 싸움: 바론 25분
    monster(25, 2, 'BARON_NASHOR'),
    at(kill(24.8, 1, 6), 5_000, 10_400),
    // 오브젝트 밖 단독 킬: 8분 상대 정글 위쪽에서 내가 9를 잡음
    at(kill(8, 3, 9), 7_000, 11_000),
    // 오브젝트 밖 단독 데스: 18분 미드 우리 포탑 쪽에서 상대 정글 7이 잡음 (상대 8 어시)
    at(kill(18, 7, 3, [8]), 6_000, 6_200),
  ];
  const { match, timeline } = fakeGame({ events });
  const r = analyzeMatch({ match, timeline, puuid: puuidOf(3), championTags: TAGS });
  it('내가 참여한 오브젝트 싸움만, 킬 수·득실 점수·먼저 죽은 사람·지역', () => {
    assert.equal(r.scenes.fightAdvantage.length, 1);
    const f = r.scenes.fightAdvantage[0]!;
    assert.equal(f.startSec, 870);
    assert.deepEqual(f.objectives, [{ kind: 'DRAGON', ours: false }]);
    assert.equal(f.killsOurs, 1);
    assert.equal(f.killsTheirs, 1);
    // 득실: 내(미드) 데스 → 상대 미드 킬 점수, 우리 원딜 킬(상대 원딜 사망) → 우리, 용 → 상대 (fights.ts와 같은 셈)
    const adv = r.fight.subjects.find((s) => s.id === 'fight.advantage')!;
    assert.equal(f.pointsOurs, adv.facts.ours);
    assert.equal(f.pointsTheirs, adv.facts.theirs);
    assert.equal(f.firstDeath, 'ME');
    assert.equal(f.iDied, true);
    assert.equal(f.region, 'RIVER_BOT');
  });
  it('오브젝트 밖 단독 킬·데스: 시각·지역·관여한 상대 수·상대 정글', () => {
    const solo = r.scenes.macroSolo;
    assert.equal(solo.length, 2);
    const k = solo.find((s) => s.kind === 'KILL')!;
    const d = solo.find((s) => s.kind === 'DEATH')!;
    assert.deepEqual(k, { sec: 480, kind: 'KILL', region: 'ENEMY_JUNGLE_TOP', enemies: 1, enemyJungler: false });
    assert.deepEqual(d, { sec: 1080, kind: 'DEATH', region: 'MID_LANE_OURS', enemies: 2, enemyJungler: true });
    const solos = r.macro.subjects.find((s) => s.id === 'macro.solo')!;
    assert.equal(solos.facts.kills, 1);
    assert.equal(solos.facts.deaths, 1);
  });
  it('운영 득실 장면 = 오브젝트 창 밖에서 내가 참여한 싸움 (득실 합이 과목 facts와 같음)', () => {
    const m = r.scenes.macroAdvantage;
    const adv = r.macro.subjects.find((s) => s.id === 'macro.advantage')!;
    assert.equal(m.length, adv.facts.fights);
    assert.equal(m.reduce((s, f) => s + f.pointsOurs, 0), adv.facts.ours);
    assert.equal(m.reduce((s, f) => s + f.pointsTheirs, 0), adv.facts.theirs);
  });
  it('과목마다 최대 3개', () => {
    for (const k of ['fightVision', 'fightObjective', 'fightAdvantage', 'macroAdvantage', 'macroSolo', 'laningDeaths'] as const) {
      assert.ok(r.scenes[k].length <= SCENES_MAX, k);
    }
  });
});

describe('set5·세나 실제 판: 장면 수와 과목 facts가 맞는다', () => {
  it('교전·운영 득실 장면 수 = min(참여한 싸움 수, 3), 단독 장면 수 = min(킬+데스, 3)', () => {
    for (const g of snapshotGames()) {
      for (const p of g.match.info.participants) {
        const r = analyzeMatch({ match: g.match, timeline: g.timeline, puuid: p.puuid, championTags: TAGS });
        const fa = r.fight.subjects.find((s) => s.id === 'fight.advantage')!;
        const ma = r.macro.subjects.find((s) => s.id === 'macro.advantage')!;
        const so = r.macro.subjects.find((s) => s.id === 'macro.solo')!;
        const n = (v: unknown) => (typeof v === 'number' ? v : 0);
        assert.equal(r.scenes.fightAdvantage.length, Math.min(n(fa.facts.fights), SCENES_MAX), `${g.key} p${p.participantId} fight`);
        assert.equal(r.scenes.macroAdvantage.length, Math.min(n(ma.facts.fights), SCENES_MAX), `${g.key} p${p.participantId} macro`);
        assert.equal(r.scenes.macroSolo.length, Math.min(n(so.facts.kills) + n(so.facts.deaths), SCENES_MAX), `${g.key} p${p.participantId} solo`);
        for (const s of [...r.scenes.fightAdvantage, ...r.scenes.macroAdvantage, ...r.scenes.macroSolo]) assert.notEqual(s.region, null);
      }
    }
  });
});
