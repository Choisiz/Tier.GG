// Q5 (ai_spec): 사용자 채점 반영(A1~A5), 판단 틀 항목 빠짐 막기(B: 빈 칸 채우기·합치기·우선순위·길이 한도), Q4 실행 뒤 문제(C1~C5).
// 채점한 아리 판(test/eval/ahri2 → recent2) + recent3 3판(아리·사일러스·오공) + 가짜 판. 유료 호출 0회.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { R6_ACTION, R8_ACTION, ruleR10, ruleR5 } from '../../../../src/analysis/advice.js';
import { planItems } from '../../../../src/analysis/coverage.js';
import { createFeedbackFromResult } from '../../../../src/analysis/feedback.js';
import { analyzeMatch } from '../../../../src/analysis/index.js';
import { coverageRows } from '../../../../src/analysis/llm/coverageReport.js';
import { buildFacts, MAX_PER_KIND, MERGE_LIMIT, type FactSheet } from '../../../../src/analysis/llm/facts.js';
import { memoryLedger } from '../../../../src/analysis/llm/ledger.js';
import { DEATH_TYPE_LABEL } from '../../../../src/analysis/llm/labels.js';
import { buildUserPayload } from '../../../../src/analysis/llm/prompt.js';
import { templateFor } from '../../../../src/analysis/llm/template.js';
import { sentenceCount, verifySlot } from '../../../../src/analysis/llm/verify.js';
import { ragTargets } from '../../../../src/analysis/rag/retrieve.js';
import { finalCheck } from '../../../../src/cli/feedback.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline, JudgedResult, TimelineEvent } from '../../../../src/analysis/types.js';
import { fakeGame, kill, monster, puuidOf, TAGS } from '../helpers.js';
import { ALL_NAMES, ctxOf, NAMES, set5Sheet } from './helpers.js';

const evalDir = fileURLToPath(new URL('../../../eval/', import.meta.url));
function game(dir: string, matchId: string, pid: number): AnalysisResult {
  const read = <T>(f: string) => JSON.parse(readFileSync(resolve(evalDir, dir, f), 'utf8')) as T;
  const match = read<AnalysisMatch>(`${matchId}.match.json`);
  const timeline = read<AnalysisTimeline>(`${matchId}.timeline.json`);
  const puuid = match.info.participants.find((p) => p.participantId === pid)!.puuid;
  return analyzeMatch({ match, timeline, puuid, championTags: TAGS });
}
const ahri2 = game('recent2', 'KR_8468352867', 3); // 채점한 아리 판 (미드, 상대 다이애나)
const ahri = game('recent3', 'KR_8456658640', 3); // Q4 아리 판 (상대 피즈)
const sylas = game('recent3', 'KR_8444684709', 8);
const wukong = game('recent3', 'KR_8444657814', 7); // 정글
const sheets = new Map<string, FactSheet>([
  ['ahri2', buildFacts(ahri2, NAMES)],
  ['ahri', buildFacts(ahri, NAMES)],
  ['sylas', buildFacts(sylas, NAMES)],
  ['wukong', buildFacts(wukong, NAMES)],
]);
const sh = (k: string) => sheets.get(k)!;
const slotOf = (s: FactSheet, id: string) => s.slots.find((x) => x.slot === id)!;
const rule = (r: AnalysisResult, id: string, kind?: 'good' | 'bad') => r.advice.rules.find((x) => x.id === id && (!kind || x.kind === kind));
const run = (events: TimelineEvent[], me = 3): AnalysisResult => {
  const { match, timeline } = fakeGame({ events });
  return analyzeMatch({ match, timeline, puuid: puuidOf(me), championTags: TAGS });
};
const dmg = (participantId: number, magicDamage: number) => ({ participantId, magicDamage, physicalDamage: 0, trueDamage: 0 });

// ---------- A. 사용자 채점 반영 ----------

describe('Q5 A1: 라인 밖 문장에 라인전 전체 킬/데스/어시스트 (다이애나 "0번" 오해 막기)', () => {
  const s = sh('ahri2');
  const roam = s.slots.find((x) => x.subjectId === 'laning.roam')!;
  it('라인전 K/D/A: 나 1/1/1, 다이애나 1/0/0 (라인 밖 수는 나 2·상대 0)', () => {
    const v = (id: string) => s.byId.get(id)!.value;
    assert.deepEqual(['kills', 'deaths', 'assists'].map((k) => v(`laning.kda.me.${k}`)), [1, 1, 1]);
    assert.deepEqual(['kills', 'deaths', 'assists'].map((k) => v(`laning.kda.enemy.${k}`)), [1, 0, 0]);
    assert.deepEqual([v('laning.roam.me'), v('laning.roam.enemy')], [2, 0]);
    assert.match(String(s.byId.get('laning.roam.me')!.label), /다른 라인·정글/);
  });
  // Q7(1)이 A1을 대신한다: 라인 밖 수 대신 전체 킬 관여 먼저 → 그 킬이 어디서 났나 (자세한 검사는 q7.test.ts)
  it('템플릿(Q7): 전체 킬 관여 "나 2번(1킬 1어시스트), 다이애나 1번(1킬)" → 다이애나의 1킬은 나를 잡은 것, 내 2번은 다른 라인·정글 싸움, 검증 통과', () => {
    const t = templateFor(s, roam);
    assert.match(t.text, /킬 관여는 나 2번\(1킬 1어시스트\), 다이애나 1번\(1킬\)/);
    assert.match(t.text, /다이애나의 1킬은 3:21 .*나를 잡은 것/);
    assert.match(t.text, /내 2번은 모두 4:22 .*다른 라인·정글 싸움/);
    assert.doesNotMatch(t.text, /라인 밖 싸움/);
    assert.deepEqual(verifySlot(roam, t, ctxOf(s)), []);
  });
  it('검증기(Q7): 라인 밖 칸에 전체 킬 관여(나·상대)를 쓰지 않으면 실패 (라인 밖 수만 쓰면 "다이애나 0번" 오해)', () => {
    const f = verifySlot(roam, { text: '15:00까지 다른 라인·정글 싸움 킬·어시스트는 나 2번, 상대 다이애나 0번이었습니다.', factIds: ['laning.referenceMin', 'laning.roam.me', 'laning.roam.enemy', 'laning.opponent'] }, ctxOf(s));
    assert.ok(f.some((x) => x.rule === 'shape' && x.detail.includes('킬 관여')));
  });
});

describe('Q5 A2·A3: R8·R6 조언 말 "다음 판에는 ○○에 신경 쓰세요"', () => {
  it('R8 원인별 조언 말 (CS / 킬을 내주는 데스 / 방패 …)', () => {
    for (const v of Object.values(R8_ACTION)) assert.match(v, /^다음 판에는 .+에 신경 쓰세요$/);
    assert.equal(R8_ACTION.cs, '다음 판에는 CS에 신경 쓰세요');
    assert.equal(rule(ahri2, 'R8')!.facts.action, '다음 판에는 CS에 신경 쓰세요');
    assert.equal(R6_ACTION, '다음 판에는 라인전 1:1 교환에 더 집중해서 신경 쓰세요');
    assert.equal(rule(ahri2, 'R6')!.facts.action, R6_ACTION);
  });
  it('R8 칸: 옛 조언 "기준 시점까지 CS를 챙기세요"는 실패, 정해진 말은 통과', () => {
    const s = sh('ahri2');
    const g = slotOf(s, 'laning.bad.0');
    const ids = ['laning.referenceMin', 'laning.growth.cell', 'rule.R8.me', 'rule.R8.enemy', 'rule.R8.action'];
    const head = '15:00 라인전은 경험치는 따라갔지만 골드를 내줬고, CS가 121개로 상대의 128개보다 적었습니다.';
    const old = verifySlot(g, { text: `${head} 다음 판에는 기준 시점까지 CS를 챙기세요.`, factIds: ids }, ctxOf(s));
    assert.ok(old.some((x) => x.detail.includes('조언 근거 미인용')));
    assert.deepEqual(verifySlot(g, { text: `${head} 다음 판에는 CS에 신경 쓰세요.`, factIds: ids }, ctxOf(s)), []);
  });
  it('R6 칸: 옛 조언 "1:1 교환을 줄이세요"는 실패, "라인전 1:1 교환에 더 집중해서 신경 쓰세요"는 통과', () => {
    const s = sh('ahri2');
    const d = slotOf(s, 'laning.bad.1');
    const ids = ['rule.R6.min', 'rule.R6.region', 'rule.R6.dealt', 'rule.R6.received', 'rule.R6.trade', 'rule.R6.action'];
    const head = '3:21 미드 라인 우리 포탑 쪽에서 다이애나에게 1:1로 죽었고, 죽기 직전 내가 준 피해는 260, 받은 피해는 561로 교환 끝에 졌습니다.';
    assert.ok(verifySlot(d, { text: `${head} 다음 판에는 그 시각·지역에서 1:1 교환을 줄이세요.`, factIds: ids }, ctxOf(s)).some((x) => x.detail.includes('조언 근거 미인용')));
    assert.deepEqual(verifySlot(d, { text: `${head} 다음 판에는 라인전 1:1 교환에 더 집중해서 신경 쓰세요.`, factIds: ids }, ctxOf(s)), []);
  });
  it('프롬프트: R6·R8 칸 규칙에 action이 실린다', () => {
    const p = buildUserPayload(sh('ahri2'));
    const rules = p.slots.flatMap((x) => x.rules ?? []);
    assert.equal(rules.find((r) => r.id === 'R8')!.action, '다음 판에는 CS에 신경 쓰세요');
    assert.equal(rules.find((r) => r.id === 'R6')!.action, R6_ACTION);
  });
});

describe('Q5 A4: R4 이득 교환 (40:38 장로 용 싸움, 죽은 사람은 나 하나)', () => {
  const r4 = rule(ahri2, 'R4', 'good')!;
  it('데이터: 그 싸움 우리 팀 데스 1(나뿐)·상대 0, 장로 용 80점 > 내 데스 7점(미드) → TRADE', () => {
    assert.equal(r4.facts.status, 'TRADE');
    assert.deepEqual([r4.facts.myDeaths, r4.facts.ourDeaths, r4.facts.enemyDeaths, r4.facts.deathPoints, r4.facts.objective, r4.facts.objectivePoints], [1, 1, 0, 7, '장로 용', 80]);
    assert.equal(r4.facts.text, '내 데스 1번(상대 팀 7점)으로 우리 팀이 장로 용(80점)을 얻어 이득 교환이었습니다');
    assert.equal(Math.floor(Number(r4.facts.sec)), 2438); // 40:38
  });
  it('템플릿: 득실 좋은 점 칸에 이득 교환 문장, 검증 통과', () => {
    const s = sh('ahri2');
    const slot = s.slots.find((x) => x.subjectId === 'fight.advantage' && x.kind === 'good')!;
    const t = templateFor(s, slot);
    assert.match(t.text, /40:38 싸움은 우리 팀이 더 얻었고, 내 데스 1번\(상대 팀 7점\)으로 우리 팀이 장로 용\(80점\)을 얻어 이득 교환이었습니다/);
    assert.deepEqual(verifySlot(slot, t, ctxOf(s)), []);
    // 옛 5-4-1 문장 "먼저 잡혔지만 팀이 받아쳐 이겼습니다"는 이 칸에서 실패, 그 싸움 첫 데스 노트도 프롬프트에 안 감
    const f = verifySlot(slot, { text: '40:38 싸움은 우리 팀이 더 얻었고, 먼저 잡혔지만 팀이 받아쳐 이겼습니다.', factIds: ['rule.R4.good.min', 'rule.R4.good.outcome'] }, ctxOf(s));
    assert.ok(f.some((x) => x.rule === 'forbidden'));
    assert.ok(!buildUserPayload(s).notes.some((n) => n.text.includes('받아쳐')));
  });
  it('가짜 판: 아군이 더 많이 죽으면(나뿐도 아니고 상대보다 적지도 않음) 이득 교환 아님, 오브젝트 점수 ≤ 내 데스 점수면 아님', () => {
    // 나(미드 3) 죽음 + 아군 1(탑) 죽음, 상대 1 죽음, 우리 팀 용(10) → 데스 2 > 상대 1 → 아님
    const a = run([kill(20, 8, 3), kill(20.1, 8, 1), kill(20.2, 4, 9), monster(20.3, 2, 'DRAGON', 'FIRE_DRAGON')]);
    assert.notEqual(rule(a, 'R4', 'good')?.facts.status, 'TRADE');
    // 나만 죽고 우리 팀이 공허 유충(4점) → 4 ≤ 7 → 아님
    const b = run([kill(8, 8, 3), monster(8.2, 2, 'HORDE'), kill(8.3, 4, 9)]);
    assert.notEqual(rule(b, 'R4', 'good')?.facts.status, 'TRADE');
    // 나만 죽고 우리 팀이 바론(50점) → 이득 교환
    const c = run([kill(25, 8, 3), monster(25.2, 2, 'BARON_NASHOR')]);
    assert.equal(rule(c, 'R4', 'good')!.facts.status, 'TRADE');
  });
});

describe('Q5 A5: 결정적 장면은 시간순으로 보여 준다 (고르는 방법은 그대로)', () => {
  it('아리 판: 엔진 순서 29:36·19:24·41:25 → 칸 순서 19:24·29:36·41:25, 요약은 여전히 격차가 가장 큰 29:36', async () => {
    assert.deepEqual(ahri2.keyMoments.map((k) => Math.floor(k.startSec)), [1776, 1164, 2485]);
    const s = sh('ahri2');
    assert.deepEqual(s.slots.filter((x) => x.area === 'keyMoment').map((x) => x.index), [1, 0, 2]);
    assert.equal(ahri2.summary.keyMomentIndex, 0);
    const { feedback } = await createFeedbackFromResult({ client: null, model: 'm', effort: 'low', budgetUsd: 1, ledger: memoryLedger(), championNames: NAMES })(ahri2);
    assert.deepEqual(feedback.keyMoments.map((k) => k.index), [1, 0, 2]);
  });
});

// ---------- B. 판단 틀 항목이 빠지지 않게 ----------

describe('Q5 B: 빈 칸 채우기 (규칙·재료)', () => {
  it('아리 판: 교전 부족한 점 칸이 비어 R11(시야 등급 B라도)로 새 칸, 규칙 근거 문장', () => {
    const s = sh('ahri2');
    const v = slotOf(s, 'fight.bad.0');
    assert.deepEqual([v.subjectId, v.origin, v.rules.map((r) => r.id)], ['fight.vision', 'rule', ['R11']]);
    assert.equal(templateFor(s, v).text, '11:01에 상대 팀이 잡은 용 전 60초 동안 내 제어 와드는 0개였습니다.');
    // 등급 문장(시야 점수 높음/낮음)·장면 fact는 넣지 않는다
    assert.ok(!v.factIds.includes('fight.vision.perObjective'));
  });
  it('오공 판: 교전 좋은 점 빈 칸 = 이니시(추정) 재료, 부족한 점 빈 칸 = R10(버티기) + 같은 싸움 R4 합침', () => {
    const s = sh('wukong');
    const ini = slotOf(s, 'fight.good.1');
    assert.deepEqual([ini.subjectId, ini.origin], ['fight.initiate', 'material']);
    assert.equal(s.byId.get('fight.initiate.firstHitByMe')!.estimate, true);
    const surv = slotOf(s, 'fight.bad.1');
    assert.deepEqual([surv.subjectId, surv.origin, surv.rules.map((r) => `${r.id}${r.merged ? '+' : ''}`)], ['fight.advantage', 'rule', ['R10', 'R4+']]);
    assert.match(templateFor(s, surv).text, /^30:21에 오브젝트 싸움 첫 킬 뒤 0\.1초 만에 죽었습니다\. 30:21 싸움은 상대 팀이 더 얻었고, 이 싸움에서 나도 죽어 상대 팀이 10점을 얻었습니다\.$/);
  });
  it('Q4 아리 판: 운영 부족한 점 빈 칸 = 라인 밖 KDA 재료 (게임 전체 나 3킬 2어시스트 2데스 < 피즈 5킬 4어시스트 2데스)', () => {
    const s = sh('ahri');
    const m = slotOf(s, 'macro.bad.1');
    assert.deepEqual([m.subjectId, m.origin], ['macro.roam', 'material']);
    assert.equal(templateFor(s, m).text, '게임 전체 다른 라인·정글 싸움에서 나는 3킬 2어시스트 2데스, 상대 피즈는 5킬 4어시스트 2데스였습니다.');
  });
  it('사일러스 판: 이긴 싸움에서 나도 죽은 R4(좋은 점)는 혼자 칸을 만들지 않는다 (좋은 점 빈 칸은 그대로)', () => {
    const s = sh('sylas');
    assert.equal(s.slots.filter((x) => x.area === 'fight' && x.kind === 'good').length, 0);
    const drop = s.merges.find((m) => m.candidate.rule.id === 'R4' && m.candidate.kind === 'good')!;
    assert.equal(drop.slot, null);
    assert.match(drop.reason, /혼자 칸을 만들지 않는 R4/);
  });
});

describe('Q5 B: 합치기 · 우선순위 · 길이 한도', () => {
  it('오공 판: R4(좋은 점, 살아남음)는 좋은 점 칸이 다 차서 같은 23:09 싸움의 이니시 칸에 합침 (129자) → 합친 규칙 mention이 없으면 검증 실패', () => {
    const s = sh('wukong');
    const ini = slotOf(s, 'fight.good.1');
    assert.equal(ini.subjectId, 'fight.initiate');
    const r4 = ini.rules.find((r) => r.id === 'R4')!;
    assert.ok(r4.merged);
    assert.deepEqual(r4.mention, ['rule.R4.good.min']);
    assert.ok(!slotOf(s, 'fight.good.0').rules.some((r) => r.id === 'R4'));
    const t = templateFor(s, ini);
    assert.match(t.text, /^23:09 우리 팀이 바론을 잡은 싸움에서 .*23:09 싸움은 우리 팀이 더 얻었고, 이 싸움에서 나는 살아남았습니다\.$/);
    assert.equal(t.text.length, 129);
    assert.deepEqual(verifySlot(ini, t, ctxOf(s)), []);
    const without = verifySlot(ini, { text: '23:09 우리 팀이 바론을 잡은 싸움에서 첫 킬에 내가 참여했습니다.', factIds: ['fight.initiate.min', 'fight.initiate.objective'] }, ctxOf(s));
    assert.ok(without.some((f) => f.rule === 'shape' && f.detail.includes('합친 R4')));
  });
  it('우선순위: 교전 부족한 점 빈 칸이 하나면 버티기(R10)가 시야(R11)보다 먼저, R11은 합칠 후보로', () => {
    const r = structuredClone(wukong) as AnalysisResult;
    r.speakOrder.fight.bad = ['fight.objective']; // 등급 과목 1칸만 차 있다고 둔다
    const plan = planItems(r);
    const bad = plan.items.filter((x) => x.area === 'fight' && x.kind === 'bad');
    assert.deepEqual(bad.map((x) => [x.subjectId, x.origin, x.rules[0]?.id ?? null]), [['fight.objective', 'graded', null], ['fight.advantage', 'rule', 'R10']]);
    assert.ok(plan.merges.some((m) => m.rule.id === 'R11' && m.why === 'full'));
    // 두 칸이 비면 둘 다 새 칸 (R10 먼저)
    r.speakOrder.fight.bad = [];
    assert.deepEqual(planItems(r).items.filter((x) => x.area === 'fight' && x.kind === 'bad').map((x) => x.rules[0]!.id), ['R10', 'R11']);
  });
  it('길이 한도 145자(사용자 결정 2026-11-22): Q4 아리 판 R9(라인 밖)는 라인전 데스 칸에 합쳐진다 (템플릿 142자)', () => {
    const s = sh('ahri');
    assert.deepEqual(MERGE_LIMIT, { chars: 145, sentences: 3 });
    const m = s.merges.find((x) => x.candidate.rule.id === 'R9')!;
    assert.deepEqual(m.candidate.targets, ['laning.deaths', 'laning.growth']);
    assert.deepEqual([m.slot, m.reason], ['laning.bad.1', '합침']);
    const t = templateFor(s, slotOf(s, 'laning.bad.1'));
    assert.match(t.text, /다른 라인·정글 싸움 킬·어시스트는 나 2번, 상대 피즈 3번이었습니다\.$/);
    assert.equal(t.text.length, 142);
    const row = coverageRows(s).find((x) => x.framework === '라인전 · 팀 성장(라인 밖)')!;
    assert.deepEqual([row.status, row.slot], ['말함', 'laning.bad.1']);
  });
  it('길이 한도를 넘으면 뺀다 (set5 딜정글 판: 넘친 딜 과목 R1·득실 과목 R2는 합칠 칸 둘 다 145자·3문장을 넘어 빠짐, 이유 기록)', () => {
    const s = set5Sheet('KR_8419458143');
    const drop = s.merges.filter((m) => m.slot === null);
    // Q7: 득실 칸이 두 팀 점수 문장(몫 % 문장보다 김)이 되어 R11은 막타 칸으로 가고, 그 칸이 3문장이 차서 R1(딜)도 빠진다
    assert.deepEqual(drop.map((m) => [m.candidate.rule.id, m.reason]), [
      ['R1', '길이 한도 (템플릿 145자·3문장)'],
      ['R2', '길이 한도 (템플릿 145자·3문장)'],
    ]);
    // R11(시야)은 우선순위가 높아 먼저 합쳐진다
    assert.equal(s.merges.find((m) => m.candidate.rule.id === 'R11')!.slot, 'fight.bad.0');
  });
  it('합친 칸은 모두 템플릿 145자·3문장 안, 모든 판·칸 수는 계약대로 (좋은 점·부족한 점 각 0~2, 결정적 장면 0~3), 템플릿 검증 통과', () => {
    for (const [k, s] of sheets) {
      for (const area of ['laning', 'fight', 'macro'] as const) {
        for (const kind of ['good', 'bad'] as const) assert.ok(s.slots.filter((x) => x.area === area && x.kind === kind).length <= MAX_PER_KIND, `${k} ${area}.${kind}`);
      }
      assert.ok(s.slots.filter((x) => x.area === 'keyMoment').length <= 3);
      for (const slot of s.slots) {
        const t = templateFor(s, slot);
        assert.deepEqual(verifySlot(slot, t, ctxOf(s)), [], `${k} ${slot.slot}: ${t.text}`);
        if (slot.rules.some((r) => r.merged)) assert.ok(t.text.length <= MERGE_LIMIT.chars && sentenceCount(t.text) <= MERGE_LIMIT.sentences, `${k} ${slot.slot}`);
      }
    }
  });
  it('RAG 검색 칸 = 문장 칸 (같은 칸 이름·과목, 합친 규칙은 검색하지 않음)', () => {
    for (const [k, s] of sheets) {
      for (const t of ragTargets(s.result)) {
        const slot = slotOf(s, t.key);
        assert.equal(slot?.subjectId, t.subjectId, `${k} ${t.key}`);
        assert.deepEqual(t.rules, [...new Set(slot.rules.filter((r) => !r.merged).map((r) => r.id))], `${k} ${t.key}`);
      }
    }
  });
  it('0원 표: 사일러스·오공·아리 두 판의 판단 틀 9항목 + Q6 칭찬 4항목이 모두 한 줄씩 (말함/빠짐/해당 없음)', () => {
    for (const [, s] of sheets) {
      const rows = coverageRows(s);
      assert.equal(rows.filter((r) => !r.framework.startsWith('기존 과목')).length, 13);
      assert.ok(rows.every((r) => ['말함', '빠짐', '해당 없음'].includes(r.status)));
    }
  });
});

// ---------- C. Q4 실행 뒤 찾은 문제 ----------

describe('Q5 C1: R10은 라인전 데스·소규모 싸움을 빼고', () => {
  it('사일러스 10:32 라인전 1:1 데스(오브젝트 창 안)는 R10이 아니다 → 22:32 싸움(첫 킬 뒤 6.1초)', () => {
    const r10 = rule(sylas, 'R10')!;
    assert.notEqual(Math.floor(Number(r10.facts.deathSec)), 632);
    assert.deepEqual([Math.floor(Number(r10.facts.deathSec)), r10.facts.afterSec], [1352, 6.1]);
    // 아리(채점 판) 40:38 장로 용 싸움은 우리 팀 관여가 나 혼자라 R10 없음
    assert.equal(rule(ahri2, 'R10'), undefined);
  });
  it('가짜 판: 라인전 기준 시점(15:00) 전 데스 · 양 팀 중 한쪽이 1명만 관여한 싸움은 미발동', () => {
    const early = run([monster(8, 7, 'DRAGON', 'FIRE_DRAGON'), kill(7.8, 3, 8, [4]), kill(7.8 + 5 / 60, 8, 3, [9])]);
    assert.deepEqual(ruleR10(early), []);
    const small = run([monster(20, 7, 'DRAGON', 'FIRE_DRAGON'), kill(19.5, 3, 8), kill(19.5 + 5 / 60, 8, 3)]);
    assert.deepEqual(ruleR10(small), []);
    const ok = run([monster(20, 7, 'DRAGON', 'FIRE_DRAGON'), kill(19.5, 3, 8, [4]), kill(19.5 + 5 / 60, 8, 3, [9])]);
    assert.equal(ruleR10(ok).length, 2);
  });
});

describe('Q5 C2: R5는 R6이 다룬 라인전 1:1 데스를 건너뛴다', () => {
  it('사일러스: 5:12(1:1, R6이 센 데스) 대신 다음 단독 데스 14:27, 단독 킬·데스 칸 장면도 14:27부터', () => {
    assert.equal(Math.floor(Number(rule(sylas, 'R5')!.facts.deathSec)), 867); // 14:27
    const s = sh('sylas');
    assert.equal(s.byId.get('scene.macro.solo.0.min')!.display[0], '14:27');
    // Q6: 사일러스는 1:1 킬 3번으로 P2 좋은 점 칸(macro.solo)이 따로 생겨 부족한 점 칸을 고른다
    assert.match(templateFor(s, s.slots.find((x) => x.subjectId === 'macro.solo' && x.kind === 'bad')!).text, /14:27/);
  });
  it('남은 단독 데스가 없으면 R5 없음', () => {
    const r = structuredClone(sylas) as JudgedResult;
    r.scenes.macroSolo = r.scenes.macroSolo.filter((x) => x.kind !== 'DEATH' || Math.floor(x.sec) === 312);
    assert.deepEqual(ruleR5(r), []);
  });
});

describe('Q5 C3: 정글 데스는 따로 (상대 정글과 1:1 / 수적 열세 / 그 밖)', () => {
  it('오공 7:38 데스 = 수적 열세(상대 3명: 신 짜오·카이사·뽀삐), "로밍 당함"이 아니다', () => {
    const d = wukong.laning!.deaths[0]!;
    assert.deepEqual([Math.floor(d.sec), d.type, d.enemies.length], [458, 'OUTNUMBERED', 3]);
    assert.equal(DEATH_TYPE_LABEL.OUTNUMBERED, '수적 열세');
    assert.match(templateFor(sh('wukong'), slotOf(sh('wukong'), 'laning.bad.0')).text, /상대 3명이 관여한 수적 열세 싸움에서 죽었습니다/);
  });
  it('가짜 판(나 = 블루 정글 2): 상대 정글 혼자 → 상대 정글과 1:1(교환 결과 계산), 라이너 혼자 → 그 밖, 2명 → 수적 열세. 갱·로밍 당함은 나오지 않음', () => {
    const solo: TimelineEvent = { ...kill(5, 7, 2), victimDamageDealt: [dmg(7, 100)], victimDamageReceived: [dmg(7, 900)] };
    const r = run([solo, kill(8, 8, 2), kill(11, 7, 2, [8])], 2);
    assert.deepEqual(r.laning!.deaths.map((d) => [d.type, d.oneSided]), [['JUNGLE_SOLO', true], ['OTHER', null], ['OUTNUMBERED', null]]);
    assert.ok(r.laning!.deaths.every((d) => d.type !== 'GANK' && d.type !== 'ROAM'));
  });
});

describe('Q5 C4: 시간 길이(분)는 소수로 쓰지 않는다', () => {
  it('오공 중후반 파밍 "15분 이후 시간" fact = 정수 분 + 어림 1 ("약 21분"), "21.03분"은 실패', () => {
    const s = buildFacts(wukong, NAMES);
    // 운영 좋은 점에 파밍 칸이 있다 (등급 B)
    const farm = s.slots.find((x) => x.subjectId === 'macro.farm')!;
    const f = s.byId.get('macro.farm.minutes')!;
    assert.deepEqual([f.value, f.display, f.approx], [21, ['21'], { step: 1 }]);
    const ids = ['macro.farm.minutes', 'macro.farm.perMinute'];
    const bad = verifySlot(farm, { text: '라인전 이후 21.03분 동안 분당 CS 7.09개를 챙겼습니다.', factIds: ids }, ctxOf(s));
    assert.ok(bad.some((x) => x.rule === 'number' && x.detail.includes('분은 소수로 쓰지 않는다')));
    assert.deepEqual(verifySlot(farm, { text: '라인전 이후 약 21분 동안 분당 CS 7.09개를 챙겼습니다.', factIds: ids }, ctxOf(s)), []);
  });
});

describe('Q5 C5: CLI 최종 검사에 그 판의 조각 ID를 넘긴다', () => {
  it('준 조각을 인용한 칸은 최종 검사 0, 조각 목록 없이 검사하면 shape로 센다(옛 동작)', async () => {
    const s = sh('ahri2');
    const { feedback } = await createFeedbackFromResult({ client: null, model: 'm', effort: 'low', budgetUsd: 1, ledger: memoryLedger(), championNames: NAMES })(ahri2);
    const item = feedback.sections.laning.bad[0]!;
    item.chunkIds = ['laning.growth.ALL.bad.R8'];
    feedback.meta.knowledgeIds = ['laning.growth.ALL.bad.R8'];
    assert.equal(finalCheck(s, feedback, ALL_NAMES).details.length, 0);
    const old = finalCheck(s, feedback, ALL_NAMES, []);
    assert.ok(old.details.some((d) => d.detail.includes('조각을 주지 않았는데')));
  });
});
