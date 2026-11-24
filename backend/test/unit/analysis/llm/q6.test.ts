// Q6 (ai_spec): 칭찬 규칙 P1~P4 — 1:1 킬(피해 출처), 팀 딜 순위, 발동/미발동 경계, 좋은 점 칸 우선순위,
// 칭찬 문장 검증(근거 인용·추정 값 금지·칭찬 말·커뮤니티 말투), 템플릿. 채점한 아리 판(recent2) + recent3 + set5 + 가짜 판. 유료 호출 0회.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ADVICE_RULES } from '../../../../src/analysis/advice.js';
import { planItems } from '../../../../src/analysis/coverage.js';
import type { DamagePhase } from '../../../../src/analysis/fight.js';
import { analyzeMatch } from '../../../../src/analysis/index.js';
import { buildFacts, type FactSheet } from '../../../../src/analysis/llm/facts.js';
import { SYSTEM_PROMPT } from '../../../../src/analysis/llm/prompt.js';
import { templateFor } from '../../../../src/analysis/llm/template.js';
import { verifySlot } from '../../../../src/analysis/llm/verify.js';
import { buildPraise, ruleP1, ruleP2, ruleP3, ruleP4 } from '../../../../src/analysis/praise.js';
import { loadKnowledgeDir, RULE_TARGETS } from '../../../../src/analysis/rag/chunks.js';
import { ragTargets } from '../../../../src/analysis/rag/retrieve.js';
import { DAMAGE_DIFF, DAMAGE_PHASES, PRAISE } from '../../../../src/analysis/rules.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline, JudgedResult, TimelineEvent } from '../../../../src/analysis/types.js';
import { fakeGame, kill, puuidOf, TAGS } from '../helpers.js';
import { ctxOf, NAMES, SET5_IDS, set5Sheet } from './helpers.js';

const evalDir = fileURLToPath(new URL('../../../eval/', import.meta.url));
const knowledgeDir = fileURLToPath(new URL('../../../../../docs/ai/knowledge/', import.meta.url));
function game(dir: string, matchId: string, pid: number): AnalysisResult {
  const read = <T>(f: string) => JSON.parse(readFileSync(resolve(evalDir, dir, f), 'utf8')) as T;
  const match = read<AnalysisMatch>(`${matchId}.match.json`);
  const timeline = read<AnalysisTimeline>(`${matchId}.timeline.json`);
  const puuid = match.info.participants.find((p) => p.participantId === pid)!.puuid;
  return analyzeMatch({ match, timeline, puuid, championTags: TAGS });
}
const ahri2 = game('recent2', 'KR_8468352867', 3); // 채점한 아리 판 (승, 42분)
const ahri = game('recent3', 'KR_8456658640', 3); // Q4 아리 판 (라인전 패배·킬 적음)
const sylas = game('recent3', 'KR_8444684709', 8);
const wukong = game('recent3', 'KR_8444657814', 7);
const s2 = buildFacts(ahri2, NAMES);
const slot = (s: FactSheet, id: string) => s.slots.find((x) => x.slot === id)!;
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const praiseOf = (r: AnalysisResult) => r.advice.rules.filter((x) => x.id.startsWith('P'));

// ---------- 채점한 아리 판: 메인이 원본에서 확인한 값과 같다 ----------

describe('Q6 채점한 아리 판(KR_8468352867 p3): P1·P2·P3·P4가 데이터대로', () => {
  it('팀 챔피언 딜 1위 45,378 = 팀의 25.5%', () => {
    assert.deepEqual(ahri2.scenes.teamDamage, { rank: 1, damage: 45378, teamTotal: 177714, sharePct: 25.5 });
  });
  it('1:1 킬 5번(24:13 진, 33:26 다이애나, 34:22 제라스, 38:37 진, 39:39 제라스), 그중 30분 이후 4번', () => {
    const ks = ahri2.scenes.soloKills;
    assert.deepEqual(ks.map((k) => mmss(k.sec)), ['24:13', '33:26', '34:22', '38:37', '39:39']);
    assert.deepEqual(ks.map((k) => k.victimId), [9, 8, 10, 9, 10]);
    assert.equal(ks.filter((k) => k.sec >= PRAISE.lateSec).length, 4);
  });
  it('운영 "단독 킬"(6-1) 정의·등급은 그대로: 단독 킬 2·데스 1 → B', () => {
    const solo = ahri2.macro.subjects.find((x) => x.id === 'macro.solo')!;
    assert.deepEqual([solo.facts.kills, solo.facts.deaths, solo.grade], [2, 1, 'B']);
  });
  it('P1 30분 이후 30.57% (기대 22, +8.57) · P3 딜(15.83 → 25.28 → 30.57, 라인전 열세) · P3 킬 4번 · P2 5번 · P4 8번 82.7%', () => {
    const r = (id: string, subject?: string) => ahri2.advice.rules.find((x) => x.id === id && (!subject || x.subjectId === subject))!;
    assert.deepEqual([r('P1').facts.phase, r('P1').facts.share, r('P1').facts.expected, r('P1').facts.diff], [2, 30.57, 22, 8.57]);
    const d = r('P3', 'fight.damage').facts;
    assert.deepEqual([d.share0, d.share1, d.share2, d.rising, d.laningWeak], [15.83, 25.28, 30.57, true, true]);
    assert.equal(r('P3', 'macro.solo').facts.lateCount, 4);
    assert.equal(r('P2').facts.count, 5);
    assert.deepEqual([r('P4').facts.fights, r('P4').facts.sharePct], [8, 82.7]);
    assert.ok(praiseOf(ahri2).every((x) => x.kind === 'good'));
  });
  it('좋은 점 칸: 교전 = 딜(P1+P3) → 득실(P4+R4), 운영 = 단독 킬·데스(P2+P3) 먼저', () => {
    const ids = (k: string) => slot(s2, k).rules.map((x) => x.id);
    assert.deepEqual([slot(s2, 'fight.good.0').subjectId, ids('fight.good.0')], ['fight.damage', ['P1', 'P3']]);
    assert.deepEqual([slot(s2, 'fight.good.1').subjectId, ids('fight.good.1').sort()], ['fight.advantage', ['P4', 'R4']]);
    assert.deepEqual([slot(s2, 'macro.good.0').subjectId, ids('macro.good.0')], ['macro.solo', ['P2', 'P3']]);
  });
  it('템플릿: 캐리·주도 문장, 1:1 킬 5번, 단독 킬 수는 쓰지 않음, 모두 검증 통과', () => {
    const f = templateFor(s2, slot(s2, 'fight.good.0')).text;
    // Q7(4): 게임 전체 1위(팀 딜의 25.5%)와 구간 추이(화살표)를 나누고, "미드 딜러 평균", 비중은 소수 첫째 자리
    assert.equal(
      f,
      '게임 전체 챔피언 딜은 45,378로 팀에서 가장 많았고 팀 딜의 25.5%였습니다. 구간 딜 비중은 15.8% → 25.3% → 30.6%로 올라 30:00 이후에는 미드 딜러 평균 22%보다 크게 높았고, 라인전은 열세였지만 후반에 뒤집어 게임을 주도하며 싸움을 캐리했습니다.',
    );
    const m = templateFor(s2, slot(s2, 'macro.good.0')).text;
    assert.equal(m, '24:13 진을 시작으로 상대를 1:1로 5번 잡았습니다. 그중 4번이 30:00 이후였고, 후반으로 갈수록 강해졌습니다.');
    // Q7(2·3): 몫(%) 대신 두 팀 점수와 결과 + 내 관여, R4 이득 교환은 그대로
    assert.match(templateFor(s2, slot(s2, 'fight.good.1')).text, /오브젝트 싸움 8번은 킬·포탑·오브젝트 점수로 우리 팀 363점, 상대 팀 76점으로 크게 이겼고, 우리 팀 킬 13번 중 9번\(69\.2%\)에 관여했습니다\..*이득 교환/);
    for (const s of s2.slots) assert.deepEqual(verifySlot(s, templateFor(s2, s), ctxOf(s2)), [], s.slot);
  });
});

// ---------- 다른 판에서 거짓으로 발동하지 않는다 ----------

describe('Q6 다른 판: 칭찬이 거짓으로 발동하지 않는다', () => {
  it('Q4 아리(라인전 패배·팀 딜 4위·1:1 킬 0)·오공: 칭찬 없음', () => {
    assert.deepEqual(praiseOf(ahri), []);
    assert.equal(ahri.scenes.teamDamage!.rank, 4);
    assert.deepEqual(praiseOf(wukong), []);
  });
  it('사일러스: 라인전 1:1 킬 3번(11:39·14:06·21:43)만 P2, 30분 이후 1:1 킬 0이라 P3 없음', () => {
    assert.deepEqual(praiseOf(sylas).map((x) => x.id), ['P2']);
    assert.deepEqual(sylas.scenes.soloKills.map((k) => mmss(k.sec)), ['11:39', '14:06', '21:43']);
  });
  it('set5 모든 칸 템플릿 검증 통과 (칭찬 칸 포함), 칭찬 규칙은 좋은 점에만', () => {
    for (const id of SET5_IDS) {
      const sh = set5Sheet(id);
      assert.ok(praiseOf(sh.result).every((x) => x.kind === 'good'), id);
      for (const s of sh.slots) assert.deepEqual(verifySlot(s, templateFor(sh, s), ctxOf(sh)), [], `${id} ${s.slot}`);
    }
  });
});

// ---------- 1:1 킬 판정 (피해 출처) ----------

describe('Q6 1:1 킬: 킬러 나 · 어시스트 없음 · 피해자가 받은 챔피언 피해 출처가 나뿐', () => {
  const champ = (participantId: number, name?: string) => ({ participantId, ...(name ? { name } : {}), type: 'OTHER', magicDamage: 300, physicalDamage: 0, trueDamage: 0 });
  const minion = { participantId: 0, name: 'SRU_OrderMinionMelee', type: 'MINION', magicDamage: 0, physicalDamage: 50, trueDamage: 0 };
  const run = (events: TimelineEvent[]) => {
    const { match, timeline } = fakeGame({ events });
    // 가짜 판에 championName을 붙인다 (럭스 3 = 나, 리 신 2 = 아군)
    const names = ['Garen', 'LeeSin', 'Lux', 'Caitlyn', 'Thresh', 'Ornn', 'MasterYi', 'Zed', 'MissFortune', 'Lulu'];
    match.info.participants.forEach((p, i) => (p.championName = names[i]));
    return analyzeMatch({ match, timeline, puuid: puuidOf(3), championTags: TAGS }).scenes.soloKills;
  };
  const k = (min: number, received: unknown[] | undefined, assists: number[] = []): TimelineEvent => ({ ...kill(min, 3, 8, assists), ...(received ? { victimDamageReceived: received as TimelineEvent['victimDamageReceived'] } : {}) });
  it('내 피해만 → 1:1 킬, 미니언·포탑 피해가 섞여도 1:1', () => {
    assert.equal(run([k(10, [champ(3)])]).length, 1);
    assert.equal(run([k(10, [champ(3), minion, { participantId: 0, type: 'TOWER', physicalDamage: 400 }])]).length, 1);
  });
  it('아군 챔피언 피해가 있으면 아님, 어시스트가 있으면 아님, 받은 피해 기록이 없으면 아님(확인 불가)', () => {
    assert.equal(run([k(10, [champ(3), champ(2)])]).length, 0);
    assert.equal(run([k(10, [champ(3)], [2])]).length, 0);
    assert.equal(run([k(10, undefined)]).length, 0);
    assert.equal(run([k(10, [minion])]).length, 0);
  });
  it('출처는 이름 먼저: 화상처럼 participantId가 아군(2)으로 찍혀도 이름이 내 챔피언(Lux)이면 나 (채점한 아리 판 33:26과 같은 경우)', () => {
    assert.equal(run([k(10, [champ(3), champ(2, 'Lux')])]).length, 1);
    assert.equal(run([k(10, [champ(3), champ(3, 'LeeSin')])]).length, 0);
  });
  it('피해자 팀(상대) 쪽 출처는 보지 않는다 (채점한 아리 판 24:13 진 킬의 participantId 7)', () => {
    assert.equal(run([k(10, [champ(3), champ(7)])]).length, 1);
  });
});

// ---------- P1~P4 경계 ----------

describe('Q6 P1~P4 발동/미발동 경계 (경계값 rules.ts PRAISE)', () => {
  const me = (patch: (r: JudgedResult) => void): JudgedResult => {
    const r = structuredClone(ahri2) as JudgedResult;
    patch(r);
    return r;
  };
  const ph = (k: number, share: number, expected: number): DamagePhase => ({ fromMin: DAMAGE_PHASES[k]![0], toMin: k === 2 ? 42 : DAMAGE_PHASES[k]![1], share, expected, diff: share - expected });
  it('P1: 팀 딜 1위 + 구간 차이 ≥ 8%p만 (7.99 미발동, 8 발동, 2위면 미발동)', () => {
    assert.equal(ruleP1(ahri2, [ph(0, 20, 20), ph(1, 29.99, 22)]).length, 0);
    assert.equal(ruleP1(ahri2, [ph(0, 20, 20), ph(1, 30, 22)]).length, 1);
    assert.equal(ruleP1(me((r) => (r.scenes.teamDamage!.rank = 2)), [ph(1, 40, 22)]).length, 0);
    assert.equal(ruleP1(me((r) => (r.scenes.teamDamage = null)), [ph(1, 40, 22)]).length, 0);
  });
  it('P2: 1:1 킬 3번부터 (사용자 결정 2026-11-24)', () => {
    assert.equal(ruleP2(me((r) => (r.scenes.soloKills = r.scenes.soloKills.slice(0, 2)))).length, 0);
    assert.equal(ruleP2(me((r) => (r.scenes.soloKills = r.scenes.soloKills.slice(0, 3)))).length, 1);
  });
  it('P3 운영: 30분(1800초) 이후 1:1 킬 2번부터 (1799.9초는 후반 아님)', () => {
    const at = (secs: number[]) => me((r) => (r.scenes.soloKills = secs.map((sec) => ({ sec, victimId: 8, region: null }))));
    assert.equal(ruleP3(at([1799.9, 1900]), []).length, 0);
    assert.equal(ruleP3(at([1800, 1900]), [])[0]!.subjectId, 'macro.solo');
  });
  it('P3 교전: 30분 이후 구간이 가장 높고 기대치 + 6%p 이상 (= 그 구간 딜 A 경계)', () => {
    const none = me((r) => (r.scenes.soloKills = []));
    assert.equal(ruleP3(none, [ph(0, 15, 20), ph(1, 25, 22), ph(2, 28, 22)]).length, 1);
    assert.equal(ruleP3(none, [ph(0, 15, 20), ph(1, 25, 22), ph(2, 27.99, 22)]).length, 0);
    assert.equal(ruleP3(none, [ph(0, 15, 20), ph(1, 31, 22), ph(2, 30, 22)]).length, 0); // 15~30분이 더 높음
    assert.equal(ruleP3(none, [ph(0, 15, 20), ph(1, 25, 22)]).length, 0); // 30분 이후 구간 없음
  });
  it('P4: 득실 A + 참여 싸움 3번부터 (A 2번·B 8번은 미발동)', () => {
    const adv = (grade: 'A' | 'B', fights: number) =>
      me((r) => {
        const s = r.fight.subjects.find((x) => x.id === 'fight.advantage')!;
        s.grade = grade;
        s.facts.fights = fights;
      });
    assert.equal(ruleP4(adv('A', 2)).length, 0);
    assert.equal(ruleP4(adv('A', 3)).length, 1);
    assert.equal(ruleP4(adv('B', 8)).length, 0);
  });
  it('경계값은 기존 규칙과 같은 기준: P3 교전 = 딜 A 경계, 후반 = 딜 구간 30분 이후 경계', () => {
    assert.equal(PRAISE.lateDiff, DAMAGE_DIFF.a);
    assert.equal(PRAISE.lateSec, DAMAGE_PHASES[2]![0] * 60);
  });
  it('칭찬 규칙은 행동 조언이 아니다 (action false), 좋은 점 칸에만', () => {
    for (const id of ['P1', 'P2', 'P3', 'P4'] as const) {
      assert.equal(ADVICE_RULES[id].action, false);
      assert.deepEqual(RULE_TARGETS[id].polarities, ['good']);
    }
  });
});

// ---------- 좋은 점 칸 우선순위 ----------

describe('Q6 좋은 점 칸: 가장 강한 칭찬 근거 먼저 (빈 칸 채우기·합치기는 Q5 그대로)', () => {
  it('말할 순서가 득실 → 딜이어도 칭찬이 큰 딜 칸(P1+P3)이 앞', () => {
    const r = structuredClone(ahri2);
    r.speakOrder.fight.good = ['fight.advantage', 'fight.damage'];
    assert.deepEqual(planItems(r).items.filter((x) => x.area === 'fight' && x.kind === 'good').map((x) => x.subjectId), ['fight.damage', 'fight.advantage']);
  });
  it('칭찬 과목이 말할 순서에 없으면 빈 칸을 채우고(사일러스 P2 → 운영 좋은 점 새 칸), 칸이 다 차면 같은 영역 칸에 합친다(set5 나서스 P2 → 운영 득실 칸)', () => {
    const sy = planItems(sylas).items.find((x) => x.area === 'macro' && x.kind === 'good')!;
    assert.deepEqual([sy.subjectId, sy.origin, sy.rules.map((x) => x.id)], ['macro.solo', 'rule', ['P2']]);
    const nasus = set5Sheet('KR_8419451137');
    const m = nasus.merges.find((x) => x.candidate.rule.id === 'P2')!;
    // Q7: 운영 득실 칸이 두 팀 점수 문장으로 길어져(134자) 다음 후보 칸(사이드 압박)에 합친다
    assert.equal(m.slot, 'macro.good.1');
    assert.match(templateFor(nasus, slot(nasus, 'macro.good.1')).text, /상대를 1:1로 3번 잡았습니다/);
  });
  it('RAG 검색 칸에 칭찬 칸이 들어가고, 그 규칙 조각이 문서에 있다', () => {
    const t = ragTargets(ahri2).filter((x) => x.kind === 'good');
    assert.deepEqual(t.map((x) => [x.subjectId, x.rules.filter((y) => y.startsWith('P'))]), [
      ['fight.damage', ['P1', 'P3']],
      ['fight.advantage', ['P4']],
      ['macro.solo', ['P2', 'P3']],
    ]);
    const ids = new Set(loadKnowledgeDir(knowledgeDir).chunks.map((c) => c.id));
    for (const id of ['fight.damage.ALL.good.P1', 'macro.solo.ALL.good.P2', 'fight.damage.ALL.good.P3', 'macro.solo.ALL.good.P3', 'fight.advantage.ALL.good.P4']) assert.ok(ids.has(id), id);
  });
});

// ---------- 칭찬 문장 검증 ----------

describe('Q6 검증기: 칭찬은 근거 인용·확정 값·담백한 말투', () => {
  const dmgSlot = slot(s2, 'fight.good.0');
  const soloSlot = slot(s2, 'macro.good.0');
  const v = (sl: ReturnType<typeof slot>, text: string, factIds: string[]) => verifySlot(sl, { text, factIds }, ctxOf(s2));
  const goodIds = ['rule.P1.teamSharePct', 'rule.P3.damage.lateMin', 'rule.P1.share', 'rule.P3.damage.share2', 'rule.P1.expected', 'rule.P3.laning'];
  const goodIds7 = ['rule.P1.teamSharePct', 'rule.P3.damage.share0', 'rule.P3.damage.share1', 'rule.P3.damage.share2', 'rule.P1.share', 'rule.P3.damage.lateMin', 'player.roleAverage', 'rule.P1.expected', 'rule.P3.laning'];
  const goodText = '게임 전체 챔피언 딜이 팀에서 가장 많았고 팀 딜의 25.5%였습니다. 구간 딜 비중은 15.8% → 25.3% → 30.6%로 올라 30:00 이후에는 미드 딜러 평균 22%보다 크게 높았고, 라인전은 열세였지만 후반에 뒤집어 게임을 주도하며 싸움을 캐리했습니다.';
  it('프롬프트의 좋은 예(P1+P3)는 통과: "캐리"는 P1 칸에서 "보입니다" 없이 쓸 수 있다', () => {
    assert.ok(SYSTEM_PROMPT.includes(goodText));
    assert.deepEqual(v(dmgSlot, goodText, goodIds7), []);
  });
  it('근거 미인용: P1 required(팀 내 비중·구간 비중·기대치)가 없으면 실패', () => {
    const f = v(dmgSlot, '30:00 이후 딜 비중이 30.6%로 가장 높아 게임을 주도하며 싸움을 캐리했습니다.', ['rule.P3.damage.lateMin', 'rule.P3.damage.share2', 'rule.P1.share']);
    assert.ok(f.some((x) => x.rule === 'shape' && x.detail.includes('칭찬 규칙 P1')), JSON.stringify(f));
  });
  it('칭찬 규칙이 있는데 칭찬을 빼고 과목 문장만 쓰면 실패', () => {
    const f = v(dmgSlot, '30:00 이후 챔피언 딜 비중이 30.6%로 미드 딜러 평균 22%보다 높았습니다.', ['fight.damage.phase2StartMin', 'fight.damage.share2', 'player.roleAverage', 'fight.damage.expected2']);
    assert.ok(f.some((x) => x.detail.includes('칭찬 규칙 P1')) && f.some((x) => x.detail.includes('칭찬 규칙 P3')));
  });
  it('추정 값(1분 단위 딜 비중)을 칭찬 근거로 쓰면 "보입니다"를 붙여도 실패 (Q7: 딜 칸에는 1분 단위 추정 딜 fact 자체가 없어 숫자 검사로 실패)', () => {
    assert.ok(!dmgSlot.factIds.some((id) => s2.byId.get(id)!.estimate), '딜 칸에 추정 fact 없음 (Q7)');
    const f = v(dmgSlot, `${goodText} 40:38 싸움 1분 동안 딜 비중 79.5%로 캐리한 것으로 보입니다.`, goodIds7);
    assert.ok(f.some((x) => x.rule === 'number' && x.detail.includes('79.5')), JSON.stringify(f));
    // 다른 칸의 추정 fact(탱 받은 피해 비중 등)를 칭찬 칸 문장에 쓰는 경우는 4-5 검사가 막는다 (가짜 추정 fact)
    const fake = { ...s2, byId: new Map([...s2.byId, ['scene.x.0.damageSharePct', { id: 'scene.x.0.damageSharePct', label: '추정', value: 79.5, unit: '%', display: ['79.5'], estimate: true as const }]]) };
    const slotX = { ...dmgSlot, factIds: [...dmgSlot.factIds, 'scene.x.0.damageSharePct'] };
    const g = verifySlot(slotX, { text: `${goodText} 1분 동안 딜 비중 79.5%로 캐리한 것으로 보입니다.`, factIds: [...goodIds7, 'scene.x.0.damageSharePct'] }, { ...ctxOf(s2), sheet: fake as FactSheet });
    assert.ok(g.some((x) => x.rule === 'forbidden' && x.detail.includes('칭찬 근거')), JSON.stringify(g));
  });
  it('칭찬 말은 그 칭찬 규칙이 있는 칸에서만: 운영 단독 킬·데스 칸(P2·P3)에 "캐리" → 실패, 시야 칸에 "주도" → 실패', () => {
    assert.ok(v(soloSlot, '상대를 1:1로 5번 잡아 캐리했습니다.', ['rule.P2.count']).some((x) => x.detail.includes('칭찬 말 "캐리"')));
    const vision = slot(s2, 'macro.good.1');
    assert.ok(v(vision, '분당 시야 점수가 0.74로 높아 게임을 주도했습니다.', ['macro.vision.perMinute']).some((x) => x.detail.includes('칭찬 말 "주도"')));
  });
  it('P2 칸에 "단독 킬"(다른 정의)을 섞으면 실패, "1:1 킬"이면 통과', () => {
    const ids = ['rule.P2.count', 'rule.P3.kills.lateCount', 'rule.P3.kills.lateMin', 'macro.solo.kills'];
    assert.ok(v(soloSlot, '단독 킬 2번, 1:1 킬 5번을 냈고 그중 4번이 30:00 이후로 후반으로 갈수록 강해졌습니다.', ids).some((x) => x.detail.includes('단독 킬')));
    assert.deepEqual(v(soloSlot, '상대를 1:1로 5번 잡았고 그중 4번이 30:00 이후로 후반으로 갈수록 강해졌습니다.', ids), []);
  });
  it('커뮤니티 말투("딜량 머신", "하드캐리", "멱살")는 칭찬 칸이든 아니든 실패 (말투 ①)', () => {
    assert.ok(v(dmgSlot, goodText.replace('싸움을 캐리했습니다', '딜량 머신처럼 하드캐리했습니다'), goodIds).some((x) => x.rule === 'forbidden' && x.detail.includes('커뮤니티 말투')));
    const lane = slot(s2, 'laning.good.0');
    assert.ok(v(lane, '라인전에서 멱살 잡고 다른 라인을 도왔습니다.', []).some((x) => x.detail.includes('커뮤니티 말투')));
  });
  it('칭찬 칸에 조언("다음 판에도 ~하세요")을 붙이면 실패 (칭찬 규칙은 행동 조언이 아님)', () => {
    assert.ok(v(dmgSlot, `${goodText} 다음 판에도 후반 딜에 신경 쓰세요.`, goodIds).some((x) => x.detail.includes('근거 없는 조언')));
  });
  it('칭찬 규칙 facts에는 추정 값이 없다 (모든 판)', () => {
    for (const sh of [s2, buildFacts(sylas, NAMES), ...SET5_IDS.map(set5Sheet)]) {
      for (const f of sh.facts) if (/^rule\.P[1-4]\./.test(f.id)) assert.notEqual(f.estimate, true, f.id);
    }
  });
});

// ---------- 엔진 전체 ----------

describe('Q6 엔진: 칭찬 규칙은 점수 밖 (판정 불변은 scenes.test 스냅숏)', () => {
  it('buildPraise는 조언 목록 끝에 붙는다 (R 규칙 뒤)', () => {
    const ids = ahri2.advice.rules.map((x) => x.id);
    const firstP = ids.findIndex((x) => x.startsWith('P'));
    assert.ok(ids.slice(firstP).every((x) => x.startsWith('P')));
    assert.equal(typeof buildPraise, 'function');
  });
});
