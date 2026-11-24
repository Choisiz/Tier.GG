// Q4 (ai_spec): 라인전 2-1 골드×레벨 표, 1장 골드 분해, 2-2 라인 밖 관여(바텀 듀오·정글 제외), 2-3 데스 유형,
// 3장 오브젝트 싸움 버티기, 조언 규칙 R6~R11 발동/미발동 경계, 검증기(라인전 조언은 R6~R9 칸만, 추정 값은 "~로 보입니다"). 유료 호출 0회.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ruleR10, ruleR11, ruleR6, ruleR7, ruleR8, ruleR9 } from '../../../../src/analysis/advice.js';
import { analyzeMatch } from '../../../../src/analysis/index.js';
import { goldTrend, laningCell, rankCauses } from '../../../../src/analysis/laning.js';
import { buildFacts, type FactSheet } from '../../../../src/analysis/llm/facts.js';
import { buildUserPayload } from '../../../../src/analysis/llm/prompt.js';
import { templateFor } from '../../../../src/analysis/llm/template.js';
import { growthDirection, verifySlot } from '../../../../src/analysis/llm/verify.js';
import { LANING_GROWTH, ONE_SIDED_RATIO, ROAM_DIFF, SURVIVE_SEC } from '../../../../src/analysis/rules.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline, FightScene, JudgedResult, LaningCellId, LaningGrowth, TimelineEvent } from '../../../../src/analysis/types.js';
import { fakeGame, kill, monster, puuidOf, TAGS, ward } from '../helpers.js';
import { ctxOf, NAMES, senaSheet, SET5_IDS, set5Sheet } from './helpers.js';

const at = (e: TimelineEvent, x: number, y: number): TimelineEvent => ({ ...e, position: { x, y } });
const dmg = (participantId: number, magicDamage: number) => ({ participantId, magicDamage, physicalDamage: 0, trueDamage: 0 });
const levelUp = (min: number, participantId: number, level: number): TimelineEvent => ({ type: 'LEVEL_UP', timestamp: Math.round(min * 60_000), participantId, level });
const plate = (min: number, killerId: number, ownerTeam: number): TimelineEvent => ({ type: 'TURRET_PLATE_DESTROYED', timestamp: Math.round(min * 60_000), killerId, teamId: ownerTeam, laneType: 'MID_LANE' });

/** 가짜 판 (helpers.fakeGame): 1~5 블루(탑 가렌·정글 리 신·미드 럭스·원딜 케이틀린·서폿 쓰레쉬), 6~10 레드(오른·마스터 이·제드·미스 포츈·룰루) */
function run(events: TimelineEvent[], me = 3): AnalysisResult {
  const { match, timeline } = fakeGame({ events });
  return analyzeMatch({ match, timeline, puuid: puuidOf(me), championTags: TAGS });
}

// 좌표 (블루 기준): 미드 우리 쪽, 바텀 우리 쪽, 위쪽 강, 상대 정글 아래쪽, 탑 라인
const MID = [7000, 7300] as const;
const BOT = [8000, 1000] as const;
const BOT_THEIRS = [13_900, 9000] as const;
const RIVER_TOP = [5007, 10_471] as const;
const ENEMY_JG_BOT = [11_000, 7000] as const;
const TOP = [1000, 8000] as const;

// ---------- 2-1 ----------

describe('Q4 2-1 골드×레벨 표 (여섯 칸 + 골드 같음 세 칸)', () => {
  const band = LANING_GROWTH.goldEvenBand;
  const cases: [gold: number, level: number, cell: LaningCellId, verdict: string][] = [
    [band + 1, 1, 'LEAD', '우세'],
    [band + 1, 0, 'GOLD_LEAD', '우세'],
    [band + 1, -1, 'GAP_COVERED', '비슷'],
    [-(band + 1), 1, 'BASICS_KEPT', '비슷'],
    [-(band + 1), 0, 'XP_KEPT_GOLD_LOST', '열세'],
    [-(band + 1), -2, 'LOST', '열세'],
    [band, 1, 'LEVEL_LEAD', '우세'],
    [-band, 0, 'EVEN', '비슷'],
    [0, -1, 'LEVEL_BEHIND', '열세'],
  ];
  for (const [g, l, cell, verdict] of cases) {
    it(`골드 차 ${g} · 레벨 차 ${l} → ${cell} (${verdict})`, () => {
      const c = laningCell(g, l);
      assert.equal(c.id, cell);
      assert.equal(c.verdict, verdict);
    });
  }
  it('골드 같음 경계: |차| ≤ 150이면 같음, 151이면 앞섬/뒤짐', () => {
    assert.equal(band, 150);
    assert.deepEqual([goldTrend(150), goldTrend(-150), goldTrend(151), goldTrend(-151)], ['EVEN', 'EVEN', 'AHEAD', 'BEHIND']);
  });
  it('사용자 칸 이름 그대로', () => {
    assert.equal(laningCell(500, 1).label, '라인전 우위');
    assert.equal(laningCell(500, -1).label, '성장 격차를 잘 따라감');
    assert.equal(laningCell(-500, 1).label, '기본기는 잘 따라감');
    assert.equal(laningCell(-500, -1).label, '라인전 패배');
  });
});

// ---------- 1장 골드 분해 ----------

describe('Q4 1장 골드 분해: 원인 큰 순 2개 (칸마다 고르는 쪽)', () => {
  const base = (o: Partial<Omit<LaningGrowth, 'causes'>> = {}): Omit<LaningGrowth, 'causes'> => ({
    cs: { me: 100, enemy: 100 },
    kills: { me: 0, enemy: 0 },
    assists: { me: 0, enemy: 0 },
    killBounty: { me: 0, enemy: 0 },
    deathBounty: { me: 0, enemy: 0 },
    plates: { me: 0, enemy: 0 },
    turrets: { me: 0, enemy: 0 },
    deaths: { me: 0, enemy: 0 },
    enemyKillsOnMe: 0,
    enemyAssistsOnMe: 0,
    outOfLane: { me: 0, enemy: 0 },
    ...o,
  });
  it('골드가 갈린 칸은 골드 쪽 원인(킬 골드·CS·방패)을 어림 골드 크기순으로, 방향(favors)과 함께', () => {
    const g = base({ killBounty: { me: 0, enemy: 600 }, cs: { me: 120, enemy: 100 }, plates: { me: 0, enemy: 2 } });
    const c = rankCauses(g, laningCell(-500, 0));
    // 킬 골드 −600 > CS +20×24 = 480 > 방패 −2×66
    assert.deepEqual(c.map((x) => [x.id, x.favors, x.weight]), [
      ['killGold', 'ENEMY', -600],
      ['cs', 'ME', 20 * LANING_GROWTH.csGold],
    ]);
  });
  it('어시스트도 킬 골드 원인에 어림 골드로 더한다', () => {
    const c = rankCauses(base({ assists: { me: 0, enemy: 3 } }), laningCell(-500, 0));
    assert.deepEqual(c.map((x) => [x.id, x.weight]), [['killGold', -3 * LANING_GROWTH.assistGold]]);
  });
  it('골드 같음 + 레벨 뒤짐 → 레벨 쪽 원인(데스·라인 밖)', () => {
    const c = rankCauses(base({ deaths: { me: 3, enemy: 1 }, outOfLane: { me: 2, enemy: 1 }, cs: { me: 80, enemy: 100 } }), laningCell(0, -1));
    assert.deepEqual(c.map((x) => [x.id, x.favors]), [
      ['deaths', 'ENEMY'],
      ['outOfLane', 'ENEMY'],
    ]);
  });
  it('라인전 패배(둘 다 뒤짐)는 골드 1위 + 레벨 1위, 같음 칸은 원인 없음', () => {
    const g = base({ killBounty: { me: 0, enemy: 300 }, cs: { me: 80, enemy: 100 }, deaths: { me: 2, enemy: 0 } });
    assert.deepEqual(rankCauses(g, laningCell(-500, -1)).map((x) => x.id), ['cs', 'deaths']);
    assert.deepEqual(rankCauses(g, laningCell(0, 0)), []);
  });
});

// ---------- 아리 판 (ai_spec Q4 8장) ----------

const ahriDir = fileURLToPath(new URL('../../../eval/ahri/', import.meta.url));
const readAhri = <T>(f: string) => JSON.parse(readFileSync(resolve(ahriDir, f), 'utf8')) as T;
const ahriMatch = readAhri<AnalysisMatch>('KR_8456658640.match.json');
const ahri = analyzeMatch({ match: ahriMatch, timeline: readAhri<AnalysisTimeline>('KR_8456658640.timeline.json'), puuid: ahriMatch.info.participants.find((p) => p.participantId === 3)!.puuid, championTags: TAGS });
const ahriSheet: FactSheet = buildFacts(ahri, NAMES);

describe('Q4 아리 판 KR_8456658640 p3 = ai_spec Q4 8장', () => {
  const L = ahri.laning!;
  it('2-1: 골드 4,573 대 5,445(뒤짐), 레벨 10 대 10 → 경험치는 따라갔지만 골드를 내줌', () => {
    const gold = L.items.find((x) => x.id === 'laning.gold')!;
    const level = L.items.find((x) => x.id === 'laning.level')!;
    assert.deepEqual([gold.me, gold.enemy, level.me, level.enemy], [4573, 5445, 10, 10]);
    assert.equal(L.cell.id, 'XP_KEPT_GOLD_LOST');
    assert.equal(ahri.summary.laning, '열세');
  });
  it('원인: 상대 킬 현상금(피즈 킬 5 = 나를 1:1로 2번 + 라인 밖 3번, 갱 어시스트 1번), CS는 내가 13개 앞섬', () => {
    const g = L.growth;
    assert.deepEqual([g.killBounty.me, g.killBounty.enemy, g.kills.enemy, g.enemyKillsOnMe, g.enemyAssistsOnMe], [310, 1327, 5, 2, 1]);
    assert.deepEqual(g.causes.map((c) => [c.id, c.favors, c.me, c.enemy]), [
      ['killGold', 'ENEMY', 310, 1327],
      ['cs', 'ME', 97, 84],
    ]);
    assert.deepEqual([g.plates.me, g.plates.enemy], [3, 2]);
  });
  it('2-3: 2:17 1:1 교환 끝에 짐(515 대 390), 5:06 갱(엘리스+피즈, 위쪽 강, 와드 0), 7:33 1:1 일방적(37 대 1,283), 6레벨 피즈 5:13·나 5:37', () => {
    const d = L.deaths.map((x) => [Math.floor(x.sec), x.type, x.region, x.dealt, x.received, x.oneSided, x.wardsBefore, x.levelSix]);
    assert.deepEqual(d, [
      [137, 'SOLO', 'MID_LANE_OURS', 515, 390, false, 0, false],
      [306, 'GANK', 'RIVER_TOP', 186, 572, null, 0, false],
      [453, 'SOLO', 'MID_LANE_OURS', 37, 1283, true, 0, false],
    ]);
    assert.deepEqual(L.deaths[1]!.enemies, [7, 8]);
    assert.equal(L.deaths[1]!.enemyJunglerId, 7);
    // 엔진 시각은 0.1초 반올림(313.96 → 314.0): 문장 표기는 5:14 (8장의 5:13은 원본 ms 내림)
    assert.deepEqual([L.levelSix.enemySec, L.levelSix.meSec], [314, 337.7]);
  });
  it('2-2: 피즈 라인 밖 3(10:55·11:21·13:04), 나 2(12:30·12:40), 13:03 방패 → 상대 로밍 우위', () => {
    const r = L.roam!;
    assert.deepEqual(r.enemy.map((x) => Math.floor(x.sec)), [655, 681, 784]);
    assert.deepEqual(r.me.map((x) => Math.floor(x.sec)), [750, 760]);
    assert.deepEqual(r.platesWhileAwaySec.map(Math.floor), [783]);
    assert.equal(r.verdict, 'OPPONENT');
  });
  it('발동 조언: R6(7:33 일방적 1:1), R7(5:06 갱, 와드 0), R8(원인 1위 킬 골드 → 데스 줄이기), R9(로밍 + 방패)', () => {
    const by = (id: string) => ahri.advice.rules.find((r) => r.id === id)!;
    assert.deepEqual([Math.floor(by('R6').facts.sec as number), by('R6').facts.oneSided], [453, true]);
    assert.deepEqual([Math.floor(by('R7').facts.sec as number), by('R7').facts.junglerId, by('R7').facts.wardsBefore], [306, 7, 0]);
    // Q5(A2): 조언 말은 "다음 판에는 ○○에 신경 쓰세요"
    assert.deepEqual([by('R8').facts.cause, by('R8').facts.action], ['killGold', '다음 판에는 상대에게 킬을 내주는 데스에 신경 쓰세요']);
    assert.deepEqual([by('R9').facts.enemy, by('R9').facts.me, (by('R9').facts.platesWhileAwaySec as number[]).length], [3, 2, 1]);
    assert.deepEqual(
      ahri.advice.rules.filter((r) => r.subjectId.startsWith('laning.')).map((r) => [r.id, r.subjectId]),
      [
        ['R6', 'laning.deaths'],
        ['R7', 'laning.deaths'],
        ['R8', 'laning.growth'],
        ['R9', 'laning.roam'],
      ],
    );
  });
  it('말할 순서: 부족한 점 성장 → 데스 → 라인 밖 (칸은 2개라 성장·데스, Q5: 라인 밖 R9는 데스 칸에 합침)', () => {
    assert.deepEqual(ahri.speakOrder.laning, { good: [], bad: ['laning.growth', 'laning.deaths', 'laning.roam'] });
    assert.deepEqual(ahriSheet.slots.filter((s) => s.area === 'laning').map((s) => [s.subjectId, s.rules.map((r) => `${r.id}${r.merged ? '+' : ''}`)]), [
      ['laning.growth', ['R8']],
      ['laning.deaths', ['R6', 'R7', 'R9+']],
    ]);
    assert.ok(ahriSheet.allowedNames.includes('엘리스'));
  });
});

// ---------- 2-2 ----------

describe('Q4 2-2 라인 밖 관여: 바텀 듀오·내 라인에 온 정글·정글 본인 제외', () => {
  it('미드: 상대 정글을 미드에서 잡은 것은 라인 밖이 아니고, 상대 정글에서 잡은 것은 라인 밖', () => {
    const r = run([at(kill(4, 3, 7), ...MID), at(kill(6, 3, 7), ...ENEMY_JG_BOT)]);
    assert.deepEqual(r.laning!.roam!.me.map((x) => x.sec), [360]);
  });
  it('원딜: 상대 서폿(듀오)을 잡은 것은 라인 밖이 아니고, 바텀에 온 상대 미드를 바텀에서 잡은 것도 아니다. 탑에서 잡으면 라인 밖', () => {
    const r = run([at(kill(4, 4, 10), ...BOT), at(kill(5, 4, 8), ...BOT), at(kill(6, 4, 6), ...TOP)], 4);
    assert.deepEqual(r.laning!.roam!.me.map((x) => x.sec), [360]);
  });
  it('상대 미드가 바텀에서 우리 원딜을 잡으면 상대 라인 밖 1 → 차이 1 이상이면 상대 로밍 우위(경계 1)', () => {
    assert.equal(ROAM_DIFF, 1);
    const r = run([at(kill(8, 8, 4), ...BOT)]);
    assert.deepEqual([r.laning!.roam!.enemy.length, r.laning!.roam!.me.length, r.laning!.roam!.verdict], [1, 0, 'OPPONENT']);
    assert.deepEqual(r.speakOrder.laning.bad, ['laning.roam']);
    const even = run([at(kill(8, 8, 4), ...BOT), at(kill(9, 3, 9), ...BOT_THEIRS)]);
    assert.equal(even.laning!.roam!.verdict, 'EVEN');
  });
  it('상대가 라인 밖에 간 시각 ±60초 안 내 방패만 센다', () => {
    const r = run([at(kill(8, 8, 4), ...BOT), plate(8.9, 3, 200), plate(9.2, 3, 200)]);
    assert.deepEqual(r.laning!.roam!.platesWhileAwaySec, [534]);
    assert.equal(r.laning!.growth.plates.me, 2);
  });
  it('정글은 2-2를 하지 않는다 (roam null, 라인 밖 원인 0)', () => {
    const r = run([at(kill(6, 2, 8), ...MID)], 2);
    assert.equal(r.laning!.roam, null);
    assert.deepEqual(r.laning!.growth.outOfLane, { me: 0, enemy: 0 });
  });
});

// ---------- 2-3 ----------

describe('Q4 2-3 데스 유형 (1:1·갱·로밍 당함·다이브·6레벨, 그 밖)', () => {
  it('1:1: 킬러 = 상대 라이너, 어시스트 없음. 준 피해 < 받은 피해 × 1/3이면 일방적, 아니면 교환 끝에 짐', () => {
    assert.equal(ONE_SIDED_RATIO, 1 / 3);
    const solo = (dealt: number, received: number) =>
      run([{ ...at(kill(3, 8, 3), ...MID), victimDamageDealt: [dmg(8, dealt)], victimDamageReceived: [dmg(8, received), dmg(0, 500)] }]).laning!.deaths[0]!;
    const a = solo(99, 300);
    assert.deepEqual([a.type, a.dealt, a.received, a.oneSided], ['SOLO', 99, 300, true]); // 미니언 피해(참가자 0)는 받은 피해에 넣지 않는다
    assert.equal(solo(100, 300).oneSided, false);
  });
  it('갱: 킬러·어시스트·받은 피해 중 하나에 상대 정글 → 갱 (받은 피해에만 있어도), 직전 60초 와드 수', () => {
    const g = run([ward(4.2, 3, 'YELLOW_TRINKET'), ward(3.5, 3, 'SIGHT_WARD'), { ...at(kill(5, 8, 3), ...RIVER_TOP), victimDamageReceived: [dmg(8, 300), dmg(7, 100)] }]).laning!.deaths[0]!;
    assert.deepEqual([g.type, g.region, g.enemyJunglerId, g.wardsBefore], ['GANK', 'RIVER_TOP', 7, 1]);
  });
  it('로밍 당함: 맞상대 밖 상대 라이너(서폿)가 관여, 정글 없음', () => {
    assert.equal(run([at(kill(7, 8, 3, [10]), ...MID)]).laning!.deaths[0]!.type, 'ROAM');
  });
  it('다이브(추정): 우리 포탑 쪽 내 라인에서 맞상대 2명 이상 (바텀 듀오), 상대 포탑 쪽이면 그 밖', () => {
    assert.equal(run([at(kill(9, 9, 4, [10]), ...BOT)], 4).laning!.deaths[0]!.type, 'DIVE');
    assert.equal(run([at(kill(9, 9, 4, [10]), ...BOT_THEIRS)], 4).laning!.deaths[0]!.type, 'OTHER');
  });
  it('6레벨: 상대가 먼저 6을 찍은 뒤 ~ 내가 6을 찍고 60초 안의 데스만', () => {
    const six = (deathMin: number, mySix: number | null) =>
      run([levelUp(5, 8, 6), ...(mySix !== null ? [levelUp(mySix, 3, 6)] : []), at(kill(deathMin, 8, 3), ...MID)]).laning!.deaths[0]!.levelSix;
    assert.equal(six(4.9, 6), false); // 상대 6레벨 전
    assert.equal(six(5.5, 6), true);
    assert.equal(six(7, 6), true); // 내 6레벨 + 60초
    assert.equal(six(7.1, 6), false);
    assert.equal(six(9, null), true); // 나는 아직 6레벨 전
    assert.equal(six(5.5, 4.5), false); // 내가 먼저 6
  });
  it('그 밖: 챔피언이 관여하지 않은 데스(포탑 처형)', () => {
    assert.equal(run([at({ ...kill(9, 0, 3), victimDamageReceived: [dmg(0, 900)] }, ...MID)]).laning!.deaths[0]!.type, 'OTHER');
  });
});

// ---------- 3장 버티기 ----------

describe('Q4 3장 오브젝트 싸움 버티기 (첫 킬 뒤 내가 죽은 초, 확정)', () => {
  const fightWith = (events: TimelineEvent[], me = 3) => run([monster(20, 7, 'DRAGON', 'FIRE_DRAGON'), ...events], me).scenes.objectiveFights;
  it('내가 첫 킬이면 0초, 첫 킬 5초 뒤 죽으면 5, 살았으면 null', () => {
    assert.equal(fightWith([kill(19.5, 8, 3)])[0]!.myDeathAfterFirstKillSec, 0);
    assert.equal(fightWith([kill(19.5, 3, 8), kill(19.5 + 5 / 60, 8, 3)])[0]!.myDeathAfterFirstKillSec, 5);
    const survived = fightWith([kill(19.5, 3, 8)])[0]!;
    assert.deepEqual([survived.myDeathAfterFirstKillSec, survived.inFirstKill, survived.iDied], [null, true, false]);
  });
  it('1분 프레임 딜·받은 피해·팀 내 비중 (추정 재료)', () => {
    const f = fightWith([kill(19.5, 3, 8)])[0]!;
    assert.ok(f.frame);
    assert.equal(f.frame!.damageSharePct, 20); // 가짜 판은 모두 같은 딜 → 5명 중 20%
  });
});

// ---------- R6 ~ R11 ----------

/** 결과 하나를 복사해 라인전 부분을 바꾼다 */
function withLaning(r: AnalysisResult, f: (l: NonNullable<AnalysisResult['laning']>) => void): JudgedResult {
  const c = structuredClone(r) as JudgedResult;
  f(c.laning!);
  return c;
}

describe('Q4 R6~R11 발동/미발동 경계', () => {
  it('R6: 1:1 데스 ≥ 1이면 발동(일방적 데스 먼저), 0이면 미발동', () => {
    assert.equal(ruleR6(ahri)[0]!.facts.sec, 453.1);
    assert.deepEqual(ruleR6(withLaning(ahri, (l) => (l.deaths = l.deaths.filter((d) => d.type !== 'SOLO')))), []);
    const noOneSided = withLaning(ahri, (l) => (l.deaths = l.deaths.map((d) => ({ ...d, oneSided: d.oneSided === null ? null : false }))));
    assert.equal(ruleR6(noOneSided)[0]!.facts.sec, 137.1); // 일방적이 없으면 이른 데스
  });
  it('R7: 갱 데스 ≥ 1이면 발동, 0이면 미발동', () => {
    assert.equal(ruleR7(ahri).length, 1);
    assert.deepEqual(ruleR7(withLaning(ahri, (l) => (l.deaths = l.deaths.filter((d) => d.type !== 'GANK')))), []);
  });
  it('R8: 라인전 패배·경험치는 따라갔지만 골드를 내줌 칸만, 상대 쪽이 앞선 원인이 있어야', () => {
    const cell = (id: LaningCellId) => withLaning(ahri, (l) => (l.cell = { ...l.cell, id }));
    assert.equal(ruleR8(cell('LOST')).length, 1);
    assert.equal(ruleR8(cell('XP_KEPT_GOLD_LOST')).length, 1);
    for (const id of ['LEAD', 'GOLD_LEAD', 'BASICS_KEPT', 'LEVEL_BEHIND', 'EVEN'] as const) assert.deepEqual(ruleR8(cell(id)), [], id);
    const allMine = withLaning(ahri, (l) => (l.growth.causes = l.growth.causes.filter((c) => c.favors === 'ME')));
    assert.deepEqual(ruleR8(allMine), []);
  });
  it('R9: 상대 로밍 우위만 (비슷·내 로밍 우위·정글 미발동)', () => {
    assert.equal(ruleR9(ahri).length, 1);
    assert.deepEqual(ruleR9(withLaning(ahri, (l) => (l.roam = { ...l.roam!, verdict: 'EVEN' }))), []);
    assert.deepEqual(ruleR9(withLaning(ahri, (l) => (l.roam = null))), []);
  });
  it('R10: 딜러가 첫 킬 뒤 10초 안(10초 포함) 죽으면 발동, 10.1초·탱 유형은 미발동. 딜·득실 칸 둘 다', () => {
    assert.equal(SURVIVE_SEC, 10);
    // Q5(C1): 양 팀 각 2명 이상 관여한 싸움이어야 하므로 어시스트를 붙인다
    const r = run([monster(20, 7, 'DRAGON', 'FIRE_DRAGON'), kill(19.5, 3, 8, [4]), kill(19.5 + 10 / 60, 8, 3, [9])]);
    assert.deepEqual(ruleR10(r).map((x) => [x.subjectId, x.facts.afterSec]), [
      ['fight.damage', 10],
      ['fight.advantage', 10],
    ]);
    const late = structuredClone(r) as JudgedResult;
    late.scenes.objectiveFights = late.scenes.objectiveFights.map((f: FightScene) => ({ ...f, myDeathAfterFirstKillSec: 10.1 }));
    assert.deepEqual(ruleR10(late), []);
    const tank = structuredClone(r) as JudgedResult;
    tank.player.role = 'MID_TANK';
    assert.deepEqual(ruleR10(tank), []);
  });
  it('R11: 상대가 잡은 용·바론·전령 전 60초 제어 와드 0이면 발동, 제어 와드 1개·우리가 잡은 오브젝트·공허 유충은 미발동', () => {
    const r11 = (events: TimelineEvent[]) => run(events).advice.rules.filter((x) => x.id === 'R11');
    assert.equal(r11([monster(20, 7, 'DRAGON', 'FIRE_DRAGON')]).length, 1);
    assert.equal(r11([monster(20, 7, 'DRAGON', 'FIRE_DRAGON'), ward(19.5, 3, 'CONTROL_WARD')]).length, 0);
    assert.equal(r11([monster(20, 2, 'DRAGON', 'FIRE_DRAGON')]).length, 0);
    assert.equal(r11([monster(8, 7, 'HORDE')]).length, 0);
    // 큰 오브젝트 먼저 (바론 > 용)
    assert.equal(r11([monster(20, 7, 'DRAGON', 'FIRE_DRAGON'), monster(25, 7, 'BARON_NASHOR')])[0]!.facts.objective, 'BARON');
    assert.equal(ruleR11.length, 2);
  });
});

// ---------- 검증기 ----------

describe('Q4 검증기: 라인전 조언은 R6~R9가 발동한 칸만, 근거 인용', () => {
  const slot = (id: string) => ahriSheet.slots.find((s) => s.slot === id)!;
  const ctx = ctxOf(ahriSheet);
  const R6 = ['rule.R6.min', 'rule.R6.region', 'rule.R6.dealt', 'rule.R6.received', 'rule.R6.trade', 'rule.R6.action'];
  // Q5(합치기 145자): 이 칸에는 라인 밖 R9가 합쳐져 있어 R9 사실 한 구절(mention)을 함께 써야 한다
  const R9 = ['rule.R9.enemy', 'rule.R9.me'];
  const t9 = ' 다른 라인·정글 싸움은 상대가 3번, 내가 2번이었습니다.';
  const t6 = '7:33 미드 라인 우리 포탑 쪽에서 상대 라이너에게 1:1로 죽었고, 죽기 직전 내가 준 피해는 37, 받은 피해는 1,283으로 일방적으로 당했습니다.' + t9 + ' 다음 판에는 라인전 1:1 교환에 더 집중해서 신경 쓰세요.';
  it('R6 근거(시각·지역·준·받은 피해)를 쓰면 통과, 규칙을 뺀 같은 칸은 근거 없는 조언으로 실패', () => {
    assert.deepEqual(verifySlot(slot('laning.bad.1'), { text: t6, factIds: [...R6, ...R9] }, ctx), []);
    // 합친 R9를 빼면 shape 실패
    const noR9 = verifySlot(slot('laning.bad.1'), { text: t6.replace(t9, ''), factIds: R6 }, ctx);
    assert.ok(noR9.some((f) => f.rule === 'shape' && f.detail.includes('합친 R9')));
    const noRules = verifySlot({ ...slot('laning.bad.1'), rules: [] }, { text: t6, factIds: R6.filter((x) => !x.startsWith('rule.')) }, ctx);
    assert.ok(noRules.some((f) => f.detail.startsWith('근거 없는 조언')));
  });
  it('R6 근거 하나(받은 피해)가 빠지면 실패, R7 근거만 써도 통과(칸의 규칙 중 하나)', () => {
    const miss = verifySlot(slot('laning.bad.1'), { text: '7:33 미드 라인 우리 포탑 쪽에서 1:1로 죽었습니다. 다음 판에는 라인전 1:1 교환에 더 집중해서 신경 쓰세요.', factIds: ['rule.R6.min', 'rule.R6.region'] }, ctx);
    assert.ok(miss.some((f) => f.detail.startsWith('조언 근거 미인용')));
    const t7 = '5:06 위쪽 강에서 엘리스가 관여한 갱에 죽었고, 그 전 60초 동안 내가 설치한 와드는 0개였습니다.' + t9 + ' 다음 판에는 그 지역 쪽에 와드를 두세요.';
    assert.deepEqual(verifySlot(slot('laning.bad.1'), { text: t7, factIds: ['rule.R7.min', 'rule.R7.region', 'rule.R7.jungler', 'rule.R7.wardsBefore', 'rule.R7.windowSec', ...R9] }, ctx), []);
  });
  it('R8: 원인 1위 값(나·상대 킬 현상금)과 행동을 쓰면 통과', () => {
    const t = '15:00 라인전은 경험치는 따라갔지만 골드를 내줬습니다. 킬 현상금은 나 310골드, 상대 1,327골드였습니다. 다음 판에는 상대에게 킬을 내주는 데스에 신경 쓰세요.';
    assert.deepEqual(verifySlot(slot('laning.bad.0'), { text: t, factIds: ['laning.referenceMin', 'laning.growth.cell', 'rule.R8.me', 'rule.R8.enemy', 'rule.R8.action'] }, ctx), []);
  });
  it('세나 판: 규칙이 없는 라인전 좋은 점 칸 같은 곳의 조언은 실패 (Q3 원칙 유지)', () => {
    const s = senaSheet();
    const growth = s.slots.find((x) => x.subjectId === 'laning.growth')!;
    const f = verifySlot({ ...growth, rules: [] }, { text: '다음 판에는 라인전 CS를 챙기세요.', factIds: [] }, ctxOf(s));
    assert.ok(f.some((x) => x.detail.startsWith('근거 없는 조언')));
  });
});

describe('Q4 검증기: 추정 값은 "~로 보입니다", 라인전 성장 방향, 요약 칸 이름', () => {
  const s = senaSheet();
  const ctx = ctxOf(s);
  const deaths = s.slots.find((x) => x.subjectId === 'laning.deaths')!;
  const growth = s.slots.find((x) => x.subjectId === 'laning.growth')!;
  const ids = ['laning.deathsBefore.1.min', 'laning.deathsBefore.1.region', 'laning.deathsBefore.1.type'];
  it('다이브(추정) 유형을 단정하면 실패, "~로 보입니다"면 통과', () => {
    const bad = verifySlot(deaths, { text: '8:32 바텀 라인 우리 포탑 쪽에서 다이브에 죽었습니다.', factIds: ids }, ctx);
    assert.ok(bad.some((f) => f.rule === 'forbidden'));
    assert.deepEqual(verifySlot(deaths, { text: '8:32 바텀 라인 우리 포탑 쪽에서 다이브에 죽은 것으로 보입니다.', factIds: ids }, ctx), []);
  });
  it('추정 숫자(1분 딜 비중)를 쓴 문장은 그 문장 안에 "보입니다"가 있어야 한다', () => {
    const sh = set5Sheet(SET5_IDS[1]!);
    const est = sh.facts.find((f) => f.estimate && typeof f.value === 'number');
    assert.ok(est, '탱탑 판(KR_8419421568)에는 1분 단위 추정 값이 있다');
    const slot = sh.slots.find((x) => x.factIds.includes(est.id))!;
    const fails = verifySlot(slot, { text: `그 1분 값은 ${est.display[0]}였습니다.`, factIds: [est.id] }, ctxOf(sh));
    assert.ok(fails.some((f) => f.detail.includes('추정 값')), JSON.stringify(fails));
    assert.ok(!verifySlot(slot, { text: `그 1분 값은 ${est.display[0]}였던 것으로 보입니다.`, factIds: [est.id] }, ctxOf(sh)).some((f) => f.detail.includes('추정 값')));
  });
  it('성장 칸 방향: 골드가 뒤졌는데 "많았", 레벨이 같은데 "높았"는 실패. 다른 주어(CS·킬 골드)는 보지 않는다', () => {
    const cell = s.result.laning!.cell;
    assert.equal(growthDirection(cell, '15:00 골드가 상대 애쉬보다 703 많았습니다.') !== null, true);
    assert.equal(growthDirection(cell, '레벨이 높았습니다.') !== null, true);
    assert.equal(growthDirection(cell, '레벨은 같았지만 골드가 703 적었습니다.'), null);
    assert.equal(growthDirection(cell, '상대가 킬 현상금으로 700골드 더 많았습니다.'), null);
    assert.ok(verifySlot(growth, { text: '15:00 골드가 상대 애쉬보다 703 많았습니다.', factIds: ['laning.referenceMin', 'laning.opponent', 'laning.gold.diffAbs'] }, ctx).some((f) => f.rule === 'direction'));
  });
  it('요약: 라인전은 칸 이름의 말(골드를 내줌·밀렸 등)이 있어야 하고, 반대 방향(우세·우위)은 실패', () => {
    const sum = s.slots.find((x) => x.slot === 'summary')!;
    const ok = '라인전은 경험치는 따라갔지만 골드를 내줬고, 오브젝트 싸움과 그 밖의 운영은 부족했습니다.';
    assert.deepEqual(verifySlot(sum, { text: ok, factIds: [] }, ctx), []);
    assert.ok(verifySlot(sum, { text: '라인전은 우세였고, 오브젝트 싸움과 그 밖의 운영은 부족했습니다.', factIds: [] }, ctx).some((f) => f.rule === 'direction'));
    assert.ok(verifySlot(sum, { text: '오브젝트 싸움과 그 밖의 운영은 부족했습니다.', factIds: [] }, ctx).some((f) => f.detail.includes('라인전 판정')));
  });
});

describe('Q4 프롬프트·템플릿', () => {
  it('사용자 메시지: 라인전 판정은 칸 이름, 라인전 칸에 rules(R8·R6·R7 + Q5 합친 R9), 추정 fact에 estimate 표시', () => {
    const p = buildUserPayload(ahriSheet);
    assert.equal(p.verdicts['라인전'], '경험치는 따라갔지만 골드를 내줌');
    const rules = p.slots.find((x) => x.slot === 'laning.bad.1')!.rules!;
    assert.deepEqual(rules.map((r) => r.id), ['R6', 'R7', 'R9']);
    assert.deepEqual(rules[2]!.merged, { subjectId: 'laning.roam', mention: ['rule.R9.enemy', 'rule.R9.me'] });
    const sena = buildUserPayload(senaSheet());
    assert.equal(sena.facts.find((f) => f.id === 'laning.deathsBefore.1.type')!.estimate, true);
  });
  it('아리 판 템플릿: 모든 칸 검증 통과, 조언 없음, 추정 값 없음', () => {
    for (const s of ahriSheet.slots) {
      const t = templateFor(ahriSheet, s);
      assert.deepEqual(verifySlot(s, t, ctxOf(ahriSheet)), [], `${s.slot}: ${t.text}`);
      assert.doesNotMatch(t.text, /다음 판|세요/);
      assert.ok(t.factIds.every((id) => !ahriSheet.byId.get(id)!.estimate), s.slot);
    }
    const growth = templateFor(ahriSheet, ahriSheet.slots.find((s) => s.subjectId === 'laning.growth')!);
    // Q5: 칸 이름과 골드·레벨을 한 문장으로 (합칠 자리를 남기려고 짧게)
    assert.equal(growth.text, '15:00 라인전은 "경험치는 따라갔지만 골드를 내줌"으로 골드는 상대 피즈보다 872 적었고, 레벨은 같았습니다. 킬 현상금 합은 나 310골드, 상대 1,327골드였습니다.');
  });
});
