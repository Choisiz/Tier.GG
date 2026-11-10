// RAG 프롬프트·검증 (ai_spec B4-3): <knowledge> 블록, 규칙, chunkIds 스키마·검증, 버전, RAG 꺼짐이면 Q1과 같은 요청.
// 가짜 클라이언트만 쓴다. 유료 호출 0회.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { createFeedbackFromResult } from '../../../../src/analysis/feedback.js';
import { FakeLlmClient, requestHash, type Recording } from '../../../../src/analysis/llm/fakeClient.js';
import { generateTexts, type GenerateDeps } from '../../../../src/analysis/llm/generate.js';
import { memoryLedger } from '../../../../src/analysis/llm/ledger.js';
import {
  buildUserMessage,
  KNOWLEDGE_RULES,
  PROMPT_VERSION,
  PROMPT_VERSION_NO_RAG,
  SYSTEM_PROMPT,
  type KnowledgeChunkInput,
} from '../../../../src/analysis/llm/prompt.js';
import { FIRST_SCHEMA, FIRST_SCHEMA_RAG, parseFirstAnswer, parseRetryAnswer, RETRY_SCHEMA_RAG } from '../../../../src/analysis/llm/schema.js';
import { checkFirstAnswer, type FirstAnswer } from '../../../../src/analysis/llm/verify.js';
import { ALL_NAMES, ctxOf, NAMES, passingAnswer, senaResult, senaSheet, set5Sheet } from './helpers.js';

const sheet = senaSheet();
const KN: KnowledgeChunkInput[] = [
  { id: 'fight.vision.SUPPORT_DAMAGE.bad.01', content: '딜서폿의 오브젝트 전 시야가 낮을 때\n시야가 부족했을 수 있다. 다음 판에는 와드를 먼저 두어 볼 수 있다.' },
  { id: 'laning.gold.ALL.bad.01', content: '라인전 골드가 뒤졌을 때\n데스로 골드를 내줬을 수 있다. 막타를 우선해 볼 수 있다.' },
];

/** 통과하는 답에 chunkUse(칸마다 조각 ID, 빈 칸은 뺌)를 붙인다 */
function withChunks(a: FirstAnswer, ids: (slot: string) => string[]): FirstAnswer {
  const b = structuredClone(a);
  b.chunkUse = sheet.slots.map((s) => ({ slot: s.slot, chunkIds: ids(s.slot) })).filter((u) => u.chunkIds.length > 0);
  return b;
}

function deps(steps: ConstructorParameters<typeof FakeLlmClient>[0], o: Partial<GenerateDeps> = {}) {
  const client = new FakeLlmClient(steps);
  const ledger = memoryLedger();
  const d: GenerateDeps = { client, model: 'claude-opus-5-5', effort: 'low', budgetUsd: 1, ledger, allChampionNames: ALL_NAMES, now: () => 0, ...o };
  return { d, client, ledger };
}

describe('RAG 꺼짐 = Q1과 같은 요청', () => {
  const good = JSON.stringify(passingAnswer(sheet));
  it('knowledge 없음·null·빈 배열 모두 요청 해시가 같고, 시스템 프롬프트·스키마·메시지가 Q1 그대로, 버전 2026-11-10.1 (Q2)', async () => {
    const hashes: string[] = [];
    for (const knowledge of [undefined, null, []] as const) {
      const { d, client, ledger } = deps([{ text: good }], knowledge === undefined ? {} : { knowledge });
      const out = await generateTexts(sheet, d);
      const req = client.requests[0]!;
      assert.equal(req.system, SYSTEM_PROMPT);
      assert.deepEqual(req.schema, FIRST_SCHEMA);
      assert.equal(req.messages[0]!.content, buildUserMessage(sheet));
      assert.doesNotMatch(String(req.messages[0]!.content), /<knowledge>/);
      assert.equal(out.promptVersion, PROMPT_VERSION_NO_RAG);
      assert.deepEqual(out.knowledgeIds, []);
      assert.equal(ledger.entries()[0]!.promptVersion, '2026-11-10.1');
      assert.ok([...out.texts.values()].every((t) => t.chunkIds === undefined));
      hashes.push(requestHash(req));
    }
    assert.equal(new Set(hashes).size, 1);
  });

  it('Q2부터 Q1 녹화본(*2026-11-04.1*)과는 요청이 다르다 (프롬프트·장면 facts가 바뀌어 재생 호환 없음, ai_build 20장)', async () => {
    const dir = fileURLToPath(new URL('../../../eval/recordings/', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.includes('.2026-11-04.1.') && f.endsWith('.low.json'));
    assert.equal(files.length, 5);
    for (const f of files) {
      const rec = JSON.parse(readFileSync(`${dir}${f}`, 'utf8')) as Recording;
      const s = set5Sheet(rec.matchId);
      const { d, client } = deps([{ text: '{}' }, { text: '{}' }], { knowledge: null });
      await generateTexts(s, { ...d, model: rec.model, effort: rec.effort as GenerateDeps['effort'] });
      assert.notEqual(requestHash(client.requests[0]!), rec.calls[0]!.requestHash, f);
    }
  });
});

describe('RAG 켜짐: 프롬프트·스키마', () => {
  it('시스템 = Q1 프롬프트 + 지식 규칙, 사용자 메시지 = Q1 JSON + 빈 줄 + <knowledge> 블록, 스키마에 chunkIds 필수, 버전 .2', async () => {
    const good = JSON.stringify(withChunks(passingAnswer(sheet), () => []));
    const { d, client, ledger } = deps([{ text: good }], { knowledge: KN });
    const out = await generateTexts(sheet, d);
    const req = client.requests[0]!;
    assert.ok(req.system.startsWith(SYSTEM_PROMPT));
    assert.equal(req.system, SYSTEM_PROMPT + KNOWLEDGE_RULES);
    assert.match(KNOWLEDGE_RULES, /해석과 다음 판 조언의 근거로만/);
    assert.match(KNOWLEDGE_RULES, /숫자·시각·횟수는 여전히 facts에서만/);
    const msg = String(req.messages[0]!.content);
    assert.ok(msg.startsWith(`${buildUserMessage(sheet)}\n\n<knowledge>\n`));
    assert.match(msg, /<chunk id="fight\.vision\.SUPPORT_DAMAGE\.bad\.01">\n딜서폿의/);
    assert.ok(msg.endsWith('</chunk>\n</knowledge>'));
    assert.deepEqual(req.schema, FIRST_SCHEMA_RAG);
    assert.equal(out.promptVersion, PROMPT_VERSION);
    assert.equal(PROMPT_VERSION, '2026-11-10.2');
    assert.equal(ledger.entries()[0]!.promptVersion, '2026-11-10.2');
    assert.deepEqual(out.knowledgeIds, KN.map((k) => k.id));
  });
  it('RAG 스키마: 첫 답은 맨 위 chunkUse 하나(문법 크기 400 회피, 칸 객체는 Q1과 같음), 재시도 fix는 chunkIds 필수. Q1 스키마는 그대로', () => {
    assert.ok(FIRST_SCHEMA_RAG.required.includes('chunkUse'));
    assert.deepEqual(FIRST_SCHEMA_RAG.properties.sections, FIRST_SCHEMA.properties.sections);
    assert.deepEqual(FIRST_SCHEMA_RAG.properties.chunkUse.items.required, ['slot', 'chunkIds']);
    assert.ok(RETRY_SCHEMA_RAG.properties.fixes.items.required.includes('chunkIds'));
    assert.doesNotMatch(JSON.stringify(FIRST_SCHEMA), /chunk/);
  });
  it('파싱: chunkUse가 있으면 옮기고, 모양이 틀리면 오류', () => {
    const a = withChunks(passingAnswer(sheet), () => ['x']);
    assert.deepEqual(parseFirstAnswer(JSON.stringify(a))!.chunkUse![0], { slot: sheet.slots[0]!.slot, chunkIds: ['x'] });
    const bad = JSON.parse(JSON.stringify(a)) as { chunkUse: unknown };
    bad.chunkUse = [{ slot: 'summary', chunkIds: 'x' }];
    assert.equal(parseFirstAnswer(JSON.stringify(bad)), null);
    assert.deepEqual(parseRetryAnswer('{"fixes":[{"slot":"summary","text":"t","factIds":[],"chunkIds":["y"]}]}')!.fixes[0]!.chunkIds, ['y']);
  });
});

describe('RAG 켜짐: chunkIds 검증', () => {
  const ids = new Set(KN.map((k) => k.id));
  it('준 조각 안의 ID면 통과, 준 적 없는 ID는 shape 실패, 조각을 안 줬는데 chunkIds가 있으면 실패', () => {
    const okAns = withChunks(passingAnswer(sheet), (slot) => (slot === 'fight.bad.0' ? ['fight.vision.SUPPORT_DAMAGE.bad.01'] : []));
    const c1 = checkFirstAnswer(okAns, { ...ctxOf(sheet), knowledgeIds: ids });
    assert.equal(c1.failures.length, 0);
    assert.deepEqual(c1.texts.get('fight.bad.0')!.chunkIds, ['fight.vision.SUPPORT_DAMAGE.bad.01']);
    assert.deepEqual(c1.texts.get('summary')!.chunkIds, []); // 적지 않은 칸은 빈 배열
    const unknownSlot = checkFirstAnswer({ ...okAns, chunkUse: [{ slot: 'fight.bad.9', chunkIds: [] }] }, { ...ctxOf(sheet), knowledgeIds: ids });
    assert.ok(unknownSlot.extras.some((e) => /chunkUse에 없는 칸/.test(e.detail)));
    const badAns = withChunks(passingAnswer(sheet), (slot) => (slot === 'fight.bad.0' ? ['macro.side.TOP_TANK.good.01'] : []));
    const c2 = checkFirstAnswer(badAns, { ...ctxOf(sheet), knowledgeIds: ids });
    assert.deepEqual(
      c2.failures.map((f) => [f.slot, f.rule]),
      [['fight.bad.0', 'shape']],
    );
    assert.match(c2.failures[0]!.detail, /준 적 없는 조각 ID/);
    const c3 = checkFirstAnswer(okAns, ctxOf(sheet));
    assert.ok(c3.failures.some((f) => /조각을 주지 않았는데/.test(f.detail)));
  });

  it('생성: 틀린 chunkIds 칸만 재시도(RAG 재시도 스키마·chunkIds 안내) → 통과하면 llm_retry, 결과에 chunkIds·knowledgeVersion', async () => {
    const first = withChunks(passingAnswer(sheet), (slot) => (slot === 'fight.bad.0' ? ['nope'] : []));
    const fixSlot = first.sections.fight.bad[0]!;
    const fix = JSON.stringify({ fixes: [{ slot: 'fight.bad.0', text: fixSlot.text, factIds: fixSlot.factIds, chunkIds: ['fight.vision.SUPPORT_DAMAGE.bad.01'] }] });
    const client = new FakeLlmClient([{ text: JSON.stringify(first) }, { text: fix }]);
    const run = createFeedbackFromResult({ client, model: 'claude-opus-5-5', effort: 'low', budgetUsd: 1, ledger: memoryLedger(), championNames: NAMES, now: () => 0 });
    const { feedback } = await run(senaResult(), { version: 'abc123def456', chunks: KN });
    assert.equal(client.calls, 2);
    assert.deepEqual(client.requests[1]!.schema, RETRY_SCHEMA_RAG);
    assert.match(String(client.requests[1]!.messages[2]!.content), /"chunkIds"/);
    const item = feedback.sections.fight.bad[0]!;
    assert.equal(item.source, 'llm_retry');
    assert.deepEqual(item.chunkIds, ['fight.vision.SUPPORT_DAMAGE.bad.01']);
    assert.equal(feedback.meta.promptVersion, '2026-11-10.2');
    assert.equal(feedback.meta.knowledgeVersion, 'abc123def456');
    assert.deepEqual(feedback.meta.knowledgeIds, KN.map((k) => k.id));
  });

  it('조각 0개로 부르면 knowledgeVersion null·버전 .1 (RAG 없이)', async () => {
    const client = new FakeLlmClient([{ text: JSON.stringify(passingAnswer(sheet)) }]);
    const run = createFeedbackFromResult({ client, model: 'claude-opus-5-5', effort: 'low', budgetUsd: 1, ledger: memoryLedger(), championNames: NAMES, now: () => 0 });
    const { feedback } = await run(senaResult(), { version: 'abc123def456', chunks: [] });
    assert.equal(feedback.meta.knowledgeVersion, null);
    assert.equal(feedback.meta.promptVersion, '2026-11-10.1');
  });
});
