// Q7 (ai_spec): 사용자 채점(2026-11-24) 4가지 — ① 라인 밖 칸 = 전체 킬 관여 → 그 킬이 어디서 났나 ② 득실 = 몫(%) 대신 두 팀 점수와 결과
// ③ 오브젝트 싸움 내 기여(확정 값: 킬 관여 비율·잡은 상대가 받은 피해 중 내 몫·킬/데스 점수·막타) → P4 근거 / R12 부족한 점 근거
// ④ 딜 문장 = 전체 1위와 구간 추이를 나누고 "미드 딜러 평균", 비중 소수 첫째 자리, 1분 단위 추정 딜은 문장에서 뺌.
// 채점한 아리 판(recent2) + recent3 + set5 + 가짜 판. 유료 호출 0회.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ADVICE_RULES, ruleR12 } from '../../../../src/analysis/advice.js';
import { ruleFramework } from '../../../../src/analysis/coverage.js';
import { analyzeMatch } from '../../../../src/analysis/index.js';
import { buildFacts, type FactSheet } from '../../../../src/analysis/llm/facts.js';
import { FORBIDDEN_PATTERNS, ROLE_AVERAGE_LABEL } from '../../../../src/analysis/llm/labels.js';
import { templateFor } from '../../../../src/analysis/llm/template.js';
import { verifySlot } from '../../../../src/analysis/llm/verify.js';
import { ruleP4 } from '../../../../src/analysis/praise.js';
import { RULE_TARGETS } from '../../../../src/analysis/rag/chunks.js';
import { ADVANTAGE_OUTCOME, CONTRIBUTION, KILL_POINTS } from '../../../../src/analysis/rules.js';
import { contributionLevel } from '../../../../src/analysis/scenes.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline, Grade, JudgedResult, Role, TimelineEvent } from '../../../../src/analysis/types.js';
import { fakeGame, kill, monster, puuidOf, TAGS } from '../helpers.js';
import { ctxOf, NAMES, SET5_IDS, set5Sheet } from './helpers.js';

const evalDir = fileURLToPath(new URL('../../../eval/', import.meta.url));
function game(dir: string, matchId: string, pid: number): AnalysisResult {
  const read = <T>(f: string) => JSON.parse(readFileSync(resolve(evalDir, dir, f), 'utf8')) as T;
  const match = read<AnalysisMatch>(`${matchId}.match.json`);
  const timeline = read<AnalysisTimeline>(`${matchId}.timeline.json`);
  const puuid = match.info.participants.find((p) => p.participantId === pid)!.puuid;
  return analyzeMatch({ match, timeline, puuid, championTags: TAGS });
}
const ahri2 = game('recent2', 'KR_8468352867', 3); // 채점한 아리 판 (승, 42분, 미드 딜러 vs 다이애나)
const sylas = game('recent3', 'KR_8444684709', 8);
const s2 = buildFacts(ahri2, NAMES);
const sy = buildFacts(sylas, NAMES);
const slot = (s: FactSheet, id: string) => s.slots.find((x) => x.slot === id)!;
const bySubject = (s: FactSheet, subjectId: string, kind: 'good' | 'bad') => s.slots.find((x) => x.subjectId === subjectId && x.kind === kind)!;
const v = (s: FactSheet, sl: ReturnType<typeof slot>, text: string, factIds: string[]) => verifySlot(sl, { text, factIds }, ctxOf(s));
const recent3 = [game('recent3', 'KR_8456658640', 3), sylas, game('recent3', 'KR_8444657814', 7)];
const allSheets: [string, FactSheet][] = [['ahri2', s2], ...recent3.map((r) => [`recent3 ${r.matchId}`, buildFacts(r, NAMES)] as [string, FactSheet]), ...SET5_IDS.map((id) => [id, set5Sheet(id)] as [string, FactSheet])];

// ---------- ① 라인 밖 칸: 전체 킬 관여 → 그 킬이 어디서 났나 ----------

describe('Q7 ①: 라인 밖 칸은 전체 킬 관여 먼저, 그 킬이 어디서 났나 ("다이애나 0번" 오해 막기)', () => {
  it('엔진: 채점한 아리 판 라인전 킬 관여 나 2번(4:22 킬·13:28 어시스트, 모두 다른 라인·정글) · 다이애나 1번(3:21 나를 잡은 킬)', () => {
    const li = ahri2.scenes.laneInvolvement!;
    assert.deepEqual(
      li.me.map((x) => [Math.floor(x.sec), x.kind, x.where, x.region]),
      [
        [262, 'KILL', 'OUT_OF_LANE', 'ENEMY_JUNGLE_TOP'],
        [808, 'ASSIST', 'OUT_OF_LANE', 'OUR_JUNGLE_BOT'],
      ],
    );
    assert.deepEqual(li.enemy.map((x) => [Math.floor(x.sec), x.kind, x.where, x.region]), [[201, 'KILL', 'VS_LANER', 'MID_LANE_OURS']]);
    // 라인전 K/D/A(1/1/1, 1/0/0)와 라인 밖 수(2, 0)와 맞다
    assert.equal(li.me.length, 1 + 1);
    assert.equal(li.enemy.length, 1 + 0);
    assert.equal(li.me.filter((x) => x.where === 'OUT_OF_LANE').length, ahri2.laning!.roam!.me.length);
  });
  it('템플릿 = 계획의 예시 문장 내용, 검증 통과', () => {
    const t = templateFor(s2, bySubject(s2, 'laning.roam', 'good'));
    assert.equal(
      t.text,
      '15:00까지 킬 관여는 나 2번(1킬 1어시스트), 다이애나 1번(1킬)이었습니다. 다이애나의 1킬은 3:21 미드 라인 우리 포탑 쪽에서 나를 잡은 것이고, 내 2번은 모두 4:22 상대 정글 위쪽(탑 쪽) 등 다른 라인·정글 싸움이었습니다.',
    );
    assert.deepEqual(verifySlot(bySubject(s2, 'laning.roam', 'good'), t, ctxOf(s2)), []);
  });
  it('섞인 경우(사일러스): 상대 3번은 모두 나를 잡은 것, 내 4번 중 맞상대 3번·다른 라인·정글 1번', () => {
    const t = templateFor(sy, bySubject(sy, 'laning.roam', 'good')).text;
    assert.match(t, /킬 관여는 나 4번\(4킬\), 아칼리 3번\(2킬 1어시스트\)/);
    assert.match(t, /아칼리의 3번은 모두 5:12 .*나를 잡은 것이고, 내 4번 중 아칼리를 잡은 것이 3번, 다른 라인·정글 싸움이 1번이었습니다/);
  });
  it('검증기: 라인 밖 수만 쓰면 실패, 전체 킬 관여(나·상대)를 쓰면 통과', () => {
    const sl = bySubject(s2, 'laning.roam', 'good');
    const only = v(s2, sl, '15:00까지 다른 라인·정글 싸움 킬·어시스트는 나 2번, 상대 다이애나 0번이었습니다.', ['laning.referenceMin', 'laning.roam.me', 'laning.roam.enemy', 'laning.opponent']);
    assert.ok(only.some((x) => x.rule === 'shape' && x.detail.includes('킬 관여')), JSON.stringify(only));
    const ok = v(s2, sl, '15:00까지 킬 관여는 나 2번, 다이애나 1번이었습니다.', ['laning.referenceMin', 'laning.involve.me.count', 'laning.involve.enemy.count', 'laning.opponent']);
    assert.deepEqual(ok, []);
  });
  it('라인 밖 판정(2-2)·R9는 그대로 (라인 밖 수 facts·R9 문장 유지)', () => {
    assert.deepEqual([s2.byId.get('laning.roam.me')!.value, s2.byId.get('laning.roam.enemy')!.value], [2, 0]);
    assert.equal(ahri2.laning!.roam!.verdict, 'ME');
  });
});

// ---------- ② 득실: 몫(%) 대신 두 팀 점수와 결과 ----------

describe('Q7 ②: 득실 칸은 두 팀 점수와 결과 (결과 말은 등급 경계 그대로)', () => {
  it('결과 말: A 크게 이김 · B 이김 · C 비슷함 · D 짐 · E 크게 짐', () => {
    assert.deepEqual(ADVANTAGE_OUTCOME, { A: '크게 이김', B: '이김', C: '비슷함', D: '짐', E: '크게 짐' } satisfies Record<Grade, string>);
  });
  it('채점한 아리 판: P4 = 8번, 우리 팀 363점 · 상대 팀 76점, 크게 이김 (몫 82.7%는 facts에 없음)', () => {
    const p4 = ahri2.advice.rules.find((r) => r.id === 'P4')!;
    assert.deepEqual([p4.facts.fights, p4.facts.ours, p4.facts.theirs, p4.facts.outcome], [8, 363, 76, '크게 이김']);
    assert.equal(s2.byId.has('rule.P4.sharePct'), false);
    assert.ok(slot(s2, 'fight.good.1').rules.find((r) => r.id === 'P4')!.required.includes('rule.P4.ours'));
  });
  it('템플릿: 득실 칸(P4) = "킬·포탑·오브젝트 점수로 우리 팀 363점, 상대 팀 76점으로 크게 이겼고" + 이득 교환(R4)', () => {
    const t = templateFor(s2, slot(s2, 'fight.good.1'));
    assert.equal(
      t.text,
      '내가 참여한 오브젝트 싸움 8번은 킬·포탑·오브젝트 점수로 우리 팀 363점, 상대 팀 76점으로 크게 이겼고, 우리 팀 킬 13번 중 9번(69.2%)에 관여했습니다. 40:38 싸움은 우리 팀이 더 얻었고, 내 데스 1번(상대 팀 7점)으로 우리 팀이 장로 용(80점)을 얻어 이득 교환이었습니다.',
    );
    assert.doesNotMatch(t.text, /몫이 \d|%를 우리 팀이 가져/);
    assert.deepEqual(verifySlot(slot(s2, 'fight.good.1'), t, ctxOf(s2)), []);
  });
  it('모든 판의 등급 득실 칸 템플릿은 두 팀 점수를 쓰고 몫(%)을 쓰지 않는다', () => {
    let n = 0;
    for (const [k, s] of allSheets) {
      for (const sl of s.slots.filter((x) => x.origin === 'graded' && (x.subjectId === 'fight.advantage' || x.subjectId === 'macro.advantage'))) {
        const t = templateFor(s, sl).text;
        assert.match(t, /우리 팀 \d+점, 상대 팀 \d+점/, `${k} ${sl.slot}`);
        assert.doesNotMatch(t, /몫이 \d/, `${k} ${sl.slot}`);
        n++;
      }
    }
    assert.ok(n >= 5, String(n));
  });
  it('검증기: 득실 칸에서 "점수"·"N점"은 허용, 두 팀 점수를 빼면 실패, 다른 칸의 "N점"은 여전히 금지', () => {
    const sena = set5Sheet(SET5_IDS[0]!);
    const adv = bySubject(sena, 'fight.advantage', 'bad');
    const pts = ['fight.advantage.fights', 'fight.advantage.ours', 'fight.advantage.theirs'];
    assert.deepEqual(v(sena, adv, '내가 참여한 오브젝트 싸움 2번에서 킬·포탑·오브젝트를 점수로 합치면 우리 팀 5점, 상대 팀 105점으로 크게 졌습니다.', pts), []);
    const noPts = v(sena, adv, '내가 참여한 오브젝트 싸움 2번에서 크게 졌습니다.', ['fight.advantage.fights']);
    assert.ok(noPts.some((x) => x.rule === 'shape' && x.detail.includes('두 팀 점수')), JSON.stringify(noPts));
    const growth = bySubject(sena, 'laning.growth', 'bad');
    assert.ok(v(sena, growth, '킬을 점수로 합치면 우리 팀 5점이었습니다.', []).some((x) => x.rule === 'forbidden'));
  });
});

// ---------- ③ 오브젝트 싸움 내 기여 (확정 값) ----------

describe('Q7 ③: 오브젝트 싸움 내 기여 — 채점한 아리 판 (엔진의 "내가 참여한 싸움" 8번 기준)', () => {
  const c = ahri2.scenes.objectiveContribution!;
  it('우리 팀 킬 13 중 내 관여 9(7킬 2어시스트) = 69.2% · 잡은 상대가 받은 피해 중 내 몫 10,503 / 31,009 = 33.9% · 킬 39점 대 데스 14점 · 막타 0', () => {
    assert.deepEqual(
      [c.fights, c.teamKills, c.myKills, c.myAssists, c.involvementPct, c.killedDamageMine, c.killedDamageTeam, c.killedDamagePct, c.myKillPoints, c.myDeaths, c.myDeathPoints, c.lastHits.length],
      [8, 13, 7, 2, 69.2, 10503, 31009, 33.9, 39, 2, 14, 0],
    );
    // 미드(관여 72.7 이상 높음 / 40 이하 낮음)·딜러(피해 몫 40.2 / 16) 경계 사이 → 보통
    assert.deepEqual([c.involvementLevel, c.killedDamageLevel], ['MID', 'MID']);
  });
  it('보통이면 P4는 값만 싣고 required로 묶지 않는다, R12는 발동하지 않는다', () => {
    const p4 = slot(s2, 'fight.good.1').rules.find((r) => r.id === 'P4')!;
    assert.deepEqual(p4.required, ['rule.P4.fights', 'rule.P4.ours', 'rule.P4.theirs']);
    assert.ok(['rule.P4.teamKills', 'rule.P4.involvement', 'rule.P4.involvementPct', 'rule.P4.killedDamagePct'].every((id) => p4.factIds.includes(id)));
    assert.equal(ruleR12(ahri2).length, 0);
  });
  it('기여 facts는 확정 값만 (추정 표시 없음)', () => {
    for (const id of ['rule.P4.teamKills', 'rule.P4.involvement', 'rule.P4.involvementPct', 'rule.P4.killedDamagePct']) assert.equal(s2.byId.get(id)!.estimate, undefined, id);
  });
});

describe('Q7 ③: 기여 계산 (가짜 판: 럭스 3 = 나, 100팀)', () => {
  const champ = (participantId: number, dmg: number, name?: string) => ({ participantId, ...(name ? { name } : {}), type: 'OTHER', magicDamage: dmg, physicalDamage: 0, trueDamage: 0 });
  const names = ['Garen', 'LeeSin', 'Lux', 'Caitlyn', 'Thresh', 'Ornn', 'MasterYi', 'Zed', 'MissFortune', 'Lulu'];
  const run = (events: TimelineEvent[]) => {
    const { match, timeline } = fakeGame({ events });
    match.info.participants.forEach((p, i) => (p.championName = names[i]));
    return analyzeMatch({ match, timeline, puuid: puuidOf(3), championTags: TAGS });
  };
  const k = (min: number, killer: number, victim: number, assists: number[], received: unknown[]): TimelineEvent => ({ ...kill(min, killer, victim, assists), victimDamageReceived: received as TimelineEvent['victimDamageReceived'] });
  const events = [
    monster(10, 3, 'DRAGON'),
    // A: 내 킬 (제드), 받은 피해 나 300 · 아군 리 신 300 · 피해자 팀(마스터 이) 999는 보지 않는다
    k(9.9, 3, 8, [], [champ(3, 300), champ(2, 300), champ(7, 999), { participantId: 0, type: 'MINION', physicalDamage: 50 }]),
    // B: 리 신 킬 · 내 어시스트, 출처 이름 먼저: participantId 2지만 이름 Lux면 나
    k(10.1, 2, 9, [3], [champ(2, 600), champ(2, 200, 'Lux')]),
    // C: 내 데스
    k(10.2, 7, 3, [], [champ(7, 500)]),
    // D: 가렌 킬, 나는 관여 안 함
    k(10.3, 1, 10, [], [champ(1, 400)]),
    // 창 밖 킬은 세지 않는다
    k(20, 3, 6, [], [champ(3, 1000)]),
  ];
  const r = run(events);
  const c = r.scenes.objectiveContribution!;
  it('우리 팀 킬 3(A·B·D) 중 내 관여 2 = 66.7%, 피해 몫 = (300 + 200) / (300 + 300 + 800 + 400) = 27.8%', () => {
    assert.deepEqual([c.fights, c.teamKills, c.myKills, c.myAssists, c.involvementPct], [1, 3, 1, 1, 66.7]);
    assert.deepEqual([c.killedDamageMine, c.killedDamageTeam, c.killedDamagePct], [500, 1800, 27.8]);
  });
  it('킬 점수 = 잡은 상대 포지션 점수(제드 미드 7), 데스 점수 = 내 포지션 점수 × 데스(미드 7 × 1), 막타 = 내가 친 용', () => {
    assert.deepEqual([c.myKillPoints, c.myDeaths, c.myDeathPoints], [KILL_POINTS.MIDDLE, 1, KILL_POINTS.MIDDLE]);
    assert.deepEqual(c.lastHits.map((x) => [x.kind, x.points]), [['DRAGON', 10]]);
  });
  it('우리 팀 킬이 경계 수(4)보다 적으면 높음/낮음을 판단하지 않는다', () => {
    assert.equal(CONTRIBUTION.minTeamKills, 4);
    assert.deepEqual([c.involvementLevel, c.killedDamageLevel], [null, null]);
  });
  it('오브젝트 싸움에 한 번도 참여하지 않으면 null', () => {
    assert.equal(run([monster(10, 3, 'DRAGON'), k(10.1, 1, 10, [], [champ(1, 400)])]).scenes.objectiveContribution, null);
  });
});

describe('Q7 ③: 높음/낮음 경계와 P4·R12', () => {
  it('경계: 높음 = 값 이상, 낮음 = 값 이하 (미드 관여 72.7 / 40)', () => {
    const cut = CONTRIBUTION.involvement.MIDDLE;
    assert.deepEqual([72.7, 72.6, 40.1, 40].map((x) => contributionLevel(x, cut)), ['HIGH', 'MID', 'MID', 'LOW']);
    assert.equal(contributionLevel(null, cut), null);
  });
  it('경계값은 포지션(관여)·유형 묶음(피해 몫)마다 있고 높음 > 낮음', () => {
    for (const c of Object.values(CONTRIBUTION.involvement)) assert.ok(c.high > c.low);
    for (const role of Object.keys(ROLE_AVERAGE_LABEL) as Role[]) assert.ok(CONTRIBUTION.killedDamage[role].high > CONTRIBUTION.killedDamage[role].low, role);
  });
  const me = (patch: (r: JudgedResult) => void): JudgedResult => {
    const r = structuredClone(ahri2) as JudgedResult;
    patch(r);
    return r;
  };
  const withLevels = (inv: 'HIGH' | 'LOW' | 'MID', dmg: 'HIGH' | 'LOW' | 'MID') => me((r) => Object.assign(r.scenes.objectiveContribution!, { involvementLevel: inv, killedDamageLevel: dmg }));
  it('P4: 높은 기여는 플래그로 싣고, 낮은 기여는 칭찬 칸에 싣지 않는다 (그 값은 R12)', () => {
    const hi = ruleP4(withLevels('HIGH', 'MID'))[0]!.facts;
    assert.deepEqual([hi.involvementHigh, hi.killedDamageHigh, hi.involvementPct, hi.killedDamagePct], [true, false, 69.2, 33.9]);
    const low = ruleP4(withLevels('LOW', 'MID'))[0]!.facts;
    assert.deepEqual([low.involvementPct, low.killedDamagePct], [null, 33.9]);
  });
  it('R12: 관여나 피해 몫이 낮을 때만, 참여 싸움 3번 이상, 득실 부족한 점 칸, 해석(행동 조언 없음)', () => {
    assert.equal(ruleR12(withLevels('MID', 'MID')).length, 0);
    const r = ruleR12(withLevels('LOW', 'MID'))[0]!;
    assert.deepEqual([r.subjectId, r.kind, r.facts.involvementLow, r.facts.killedDamageLow, r.facts.outcome], ['fight.advantage', 'bad', true, false, '크게 이김']);
    assert.equal(ruleR12(me((r) => Object.assign(r.scenes.objectiveContribution!, { fights: 2, involvementLevel: 'LOW' }))).length, 0);
    assert.equal(ADVICE_RULES.R12.action, false);
    assert.deepEqual(RULE_TARGETS.R12, { subjects: ['fight.advantage'], polarities: ['bad'] });
    // 판단 틀: 오브젝트 · 딜량 (1분 단위 추정 딜을 대신하는 확정 값)
    assert.equal(ruleFramework(r), 'fight.damage');
  });
  it('R12 템플릿(사일러스, 득실 D): 두 팀 점수 + 낮았던 관여·피해 몫, 조언 없음, 검증 통과', () => {
    const sl = bySubject(sy, 'fight.advantage', 'bad');
    assert.ok(sl.rules.some((r) => r.id === 'R12'));
    const t = templateFor(sy, sl);
    assert.equal(
      t.text,
      '오브젝트를 잡은 시각 앞뒤 40초 동안 내가 참여한 싸움 5번에서 킬·포탑·오브젝트를 점수로 합치면 우리 팀 83점, 상대 팀 179점으로 졌습니다. 그 싸움들에서 우리 팀 킬 7번 중 내 관여는 2번(28.6%)에 그쳤고, 잡은 상대가 죽기 전 받은 챔피언 피해 중 내 몫은 8.6%로 낮았습니다.',
    );
    assert.deepEqual(verifySlot(sl, t, ctxOf(sy)), []);
  });
  it('R12 required(낮은 값)를 빼면 검증 실패하지 않지만(해석 규칙), 조언을 붙이면 실패', () => {
    const sl = bySubject(sy, 'fight.advantage', 'bad');
    const t = templateFor(sy, sl);
    const f = verifySlot(sl, { ...t, text: `${t.text.split('. ')[0]}. 다음 판에는 킬에 더 관여하세요.` }, ctxOf(sy));
    assert.ok(f.some((x) => x.rule === 'forbidden'), JSON.stringify(f));
  });
});

// ---------- ④ 딜 문장: 전체 1위 / 구간 추이, 포지션 평균, 소수 첫째 자리, 추정 딜 없음 ----------

describe('Q7 ④: 딜 문장', () => {
  it('템플릿: 전체 1위(팀 딜의 25.5%)와 구간 추이(15.8% → 25.3% → 30.6%)를 다른 문장으로, "미드 딜러 평균 22%"', () => {
    const t = templateFor(s2, slot(s2, 'fight.good.0')).text;
    const [first, second] = t.split('. ');
    assert.match(first!, /게임 전체 챔피언 딜은 45,378로 팀에서 가장 많았고 팀 딜의 25\.5%였습니다/);
    assert.match(second!, /구간 딜 비중은 15\.8% → 25\.3% → 30\.6%로 올라 30:00 이후에는 미드 딜러 평균 22%보다 크게 높았고/);
    assert.doesNotMatch(t, /기대치|이 유형/);
  });
  it('포지션 평균 이름은 유형 10개 모두 ("○○ 평균"), 공통 fact player.roleAverage', () => {
    assert.equal(Object.keys(ROLE_AVERAGE_LABEL).length, 10);
    for (const x of Object.values(ROLE_AVERAGE_LABEL)) assert.match(x, / 평균$/);
    assert.equal(s2.byId.get('player.roleAverage')!.value, '미드 딜러 평균');
    assert.ok(s2.commonFactIds.includes('player.roleAverage'));
  });
  it('비중(%·%p) facts는 모든 판에서 소수 첫째 자리까지', () => {
    for (const [k, s] of allSheets) {
      for (const f of s.facts.filter((x) => x.unit === '%' || x.unit === '%p')) assert.equal(Math.round(Number(f.value) * 10) / 10, f.value, `${k} ${f.id}=${f.value}`);
    }
  });
  it('1분 단위 추정 딜(예: 장로 용 싸움 79.5%)은 어느 판 딜 칸에도 없다 (R10 근거에도 없음)', () => {
    for (const [k, s] of allSheets) {
      assert.ok(!s.facts.some((f) => /damageSharePct$|\.damage$/.test(f.id) && f.estimate), k);
      for (const sl of s.slots.filter((x) => x.subjectId === 'fight.damage')) assert.ok(!sl.factIds.some((id) => s.byId.get(id)!.estimate), `${k} ${sl.slot}`);
    }
    for (const r of [ahri2, ...recent3]) for (const fr of r.advice.rules.filter((x) => x.id === 'R10')) assert.ok(!('damageSharePct' in fr.facts) && !('damage' in fr.facts));
  });
  it('검증기: "이 유형의 기대치"·"기대치"는 금지, 포지션 평균 값을 쓰면 포지션 이름이 있어야 함', () => {
    const dmg = slot(s2, 'fight.good.0');
    const ids = ['rule.P1.teamSharePct', 'rule.P1.share', 'rule.P3.damage.share2', 'rule.P1.expected', 'rule.P3.damage.lateMin', 'rule.P3.laning'];
    const base = '게임 전체 챔피언 딜이 팀에서 가장 많았고 팀 딜의 25.5%였습니다. 30:00 이후 딜 비중은 30.6%로';
    const tail = '보다 크게 높았고, 라인전은 열세였지만 후반에 뒤집어 게임을 주도하며 싸움을 캐리했습니다.';
    assert.ok(FORBIDDEN_PATTERNS.some((p) => p.re.test('이 유형의 기대치')));
    assert.ok(v(s2, dmg, `${base} 이 유형의 기대치 22%${tail}`, ids).some((x) => x.rule === 'forbidden' && x.detail.includes('기대치')));
    assert.ok(v(s2, dmg, `${base} 평균 22%${tail}`, ids).some((x) => x.rule === 'forbidden' && x.detail.includes('미드 딜러 평균')));
    assert.deepEqual(v(s2, dmg, `${base} 미드 딜러 평균 22%${tail}`, [...ids, 'player.roleAverage']), []);
    // 소수 둘째 자리 표기(30.57%)는 facts 표기가 아니라 실패
    assert.ok(v(s2, dmg, `${base.replace('30.6%', '30.57%')} 미드 딜러 평균 22%${tail}`, [...ids, 'player.roleAverage']).some((x) => x.rule === 'number'));
  });
});

// ---------- 모든 판 템플릿 ----------

describe('Q7 모든 판(아리·recent3·set5) 템플릿 검증 통과, 칸 길이 안', () => {
  it('모든 칸 템플릿이 검증기를 통과한다', () => {
    for (const [k, s] of allSheets) for (const sl of s.slots) assert.deepEqual(verifySlot(sl, templateFor(s, sl), ctxOf(s)), [], `${k} ${sl.slot}: ${templateFor(s, sl).text}`);
  });
});
