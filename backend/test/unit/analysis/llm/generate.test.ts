// 생성 흐름 (ai_spec 2-3, 2-6): 가짜 클라이언트로 통과 / 재시도 통과 / 재시도 실패 → 그 칸만 템플릿 / 거절 / 잘림 / 파싱 실패 / 오류 → 템플릿 / 예산
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFeedbackFromResult } from '../../../../src/analysis/feedback.js';
import { FakeLlmClient, type FakeStep } from '../../../../src/analysis/llm/fakeClient.js';
import { generateTexts, type GenerateDeps } from '../../../../src/analysis/llm/generate.js';
import { memoryLedger, type LedgerEntry } from '../../../../src/analysis/llm/ledger.js';
import { ALL_NAMES, NAMES, passingAnswer, secondResult, senaResult, senaSheet } from './helpers.js';

const sheet = senaSheet();
const good = JSON.stringify(passingAnswer(sheet));

function withWrongGold(): string {
  const a = passingAnswer(sheet);
  a.sections.laning.bad[0]!.text = '15:00 골드가 상대 애쉬보다 800 적었습니다.';
  return JSON.stringify(a);
}

const fixGold = JSON.stringify({
  fixes: [{ slot: 'laning.bad.0', text: '15:00 골드가 상대 애쉬보다 703 적었습니다.', factIds: ['laning.referenceMin', 'laning.opponent', 'laning.gold.diffAbs'] }],
});
const badFix = JSON.stringify({ fixes: [{ slot: 'laning.bad.0', text: '골드가 900 적었습니다.', factIds: ['laning.gold.diffAbs'] }] });

function deps(steps: FakeStep[], o: Partial<GenerateDeps> = {}) {
  const client = new FakeLlmClient(steps);
  const ledger = memoryLedger();
  const d: GenerateDeps = { client, model: 'claude-opus-5-5', effort: 'low', budgetUsd: 1, ledger, allChampionNames: ALL_NAMES, now: () => 0, ...o };
  return { d, client, ledger };
}

describe('생성: 통과', () => {
  it('1차가 모두 통과하면 호출 1번, mode llm, 템플릿 0', async () => {
    const { d, client, ledger } = deps([{ text: good }]);
    const out = await generateTexts(sheet, d);
    assert.equal(client.calls, 1);
    assert.equal(out.mode, 'llm');
    assert.equal(out.verification.firstPass, sheet.slots.length);
    assert.equal(out.verification.templated, 0);
    assert.ok([...out.texts.values()].every((t) => t.source === 'llm'));
    assert.equal(ledger.entries().length, 1);
    // 1000 입력 × $4 + 500 출력 × $20 (가짜 usage)
    assert.ok(Math.abs(out.costUsd - 0.014) < 1e-9);
  });
  it('요청: thinking·temperature 없음, effort low, 시스템 프롬프트 고정, 구조화 출력 스키마', async () => {
    const { d, client } = deps([{ text: good }]);
    await generateTexts(sheet, d);
    const req = client.requests[0]!;
    assert.equal(req.effort, 'low');
    assert.equal(req.maxTokens, 4500);
    assert.equal(req.messages.length, 1);
    assert.equal((req.schema as { additionalProperties: boolean }).additionalProperties, false);
    assert.doesNotMatch(JSON.stringify(req), /"thinking"|temperature|top_p|TEST_PUUID/);
  });
});

describe('생성: 재시도', () => {
  it('틀린 칸만 재시도 → 통과하면 llm_retry, 앞 응답 content를 그대로 덧붙임', async () => {
    const { d, client } = deps([{ text: withWrongGold() }, { text: fixGold }]);
    const out = await generateTexts(sheet, d);
    assert.equal(client.calls, 2);
    assert.equal(out.verification.firstPass, sheet.slots.length - 1);
    assert.equal(out.verification.retried, 1);
    assert.equal(out.texts.get('laning.bad.0')!.source, 'llm_retry');
    assert.equal(out.verification.templated, 0);
    const retry = client.requests[1]!;
    assert.equal(retry.maxTokens, 2000);
    assert.equal(retry.messages.length, 3);
    assert.equal(retry.messages[1]!.role, 'assistant');
    assert.deepEqual(retry.messages[1]!.content, [
      { type: 'thinking', thinking: '', signature: 'fake' },
      { type: 'text', text: withWrongGold() },
    ]);
    assert.deepEqual(retry.messages[0], client.requests[0]!.messages[0]);
    assert.match(String(retry.messages[2]!.content), /laning\.bad\.0/);
    assert.match(String(retry.messages[2]!.content), /800/);
  });
  it('재시도도 틀리면 그 칸만 템플릿, mode는 llm', async () => {
    const { d } = deps([{ text: withWrongGold() }, { text: badFix }]);
    const out = await generateTexts(sheet, d);
    assert.equal(out.mode, 'llm');
    assert.equal(out.verification.templated, 1);
    assert.equal(out.texts.get('laning.bad.0')!.source, 'template');
    assert.equal(out.texts.get('laning.bad.1')!.source, 'llm');
  });
  it('재시도 호출이 오류면 실패 칸만 템플릿', async () => {
    const { d } = deps([{ text: withWrongGold() }, { error: 'server', status: 529 }]);
    const out = await generateTexts(sheet, d);
    assert.equal(out.mode, 'llm');
    assert.equal(out.texts.get('laning.bad.0')!.source, 'template');
  });
});

describe('생성: 전체 템플릿으로 대체', () => {
  const cases: [string, FakeStep[], string][] = [
    ['거절', [{ refusal: true, category: 'cyber' }], 'refusal'],
    ['잘림', [{ text: '{"summary":', stopReason: 'max_tokens' }], 'max_tokens'],
    ['파싱 실패 2번', [{ text: 'not json' }, { text: '{}' }], 'parse'],
    ['401', [{ error: 'auth', status: 401 }], 'auth'],
    ['402', [{ error: 'billing', status: 402 }], 'billing'],
    ['429', [{ error: 'rate', status: 429 }], 'rate'],
    ['시간 초과', [{ error: 'timeout' }], 'timeout'],
  ];
  for (const [name, steps, reason] of cases) {
    it(`${name} → mode template, fallbackReason ${reason}`, async () => {
      const { d, client } = deps(steps);
      const out = await generateTexts(sheet, d);
      assert.equal(out.mode, 'template');
      assert.equal(out.fallbackReason, reason);
      assert.equal(out.texts.size, sheet.slots.length);
      assert.ok([...out.texts.values()].every((t) => t.source === 'template'));
      assert.equal(client.calls, steps.length);
    });
  }
  it('파싱 실패 1번 뒤 다시 하기가 통과하면 llm', async () => {
    const { d, client } = deps([{ text: 'oops' }, { text: good }]);
    const out = await generateTexts(sheet, d);
    assert.equal(client.calls, 2);
    assert.equal(out.mode, 'llm');
  });
  it('키 없음(client null) → no_key, 호출 0', async () => {
    const { d } = deps([]);
    const out = await generateTexts(sheet, { ...d, client: null });
    assert.equal(out.fallbackReason, 'no_key');
  });
});

describe('생성: 예산 장치', () => {
  const spent = (usd: number): LedgerEntry => ({
    at: '',
    matchId: 'X',
    participantId: 1,
    model: 'claude-opus-5-5',
    effort: 'low',
    promptVersion: 'x',
    attempt: 1,
    kind: 'first',
    estInputTokens: 0,
    usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
    stopReason: 'end_turn',
    costUsd: usd,
    durationMs: 0,
    recording: null,
    error: null,
  });
  it('누적 + 이번 최악 > 상한이면 호출하지 않고 템플릿 (budget)', async () => {
    const { d, client } = deps([{ text: good }], { ledger: memoryLedger([spent(0.95)]) });
    const out = await generateTexts(sheet, d);
    assert.equal(client.calls, 0);
    assert.equal(out.fallbackReason, 'budget');
  });
  it('재시도 전에도 예산 검사: 재시도가 상한을 넘으면 그 칸만 템플릿', async () => {
    // 상한을 1차 최악(~0.16, Q2 max_tokens 4500)보다 조금 크게: 1차는 되고, 1차 비용이 쌓인 뒤 재시도 최악은 넘친다
    const { d, client } = deps([{ text: withWrongGold(), usage: { input: 1000, output: 4000 } }, { text: fixGold }], { budgetUsd: 0.17 });
    const out = await generateTexts(sheet, d);
    assert.equal(client.calls, 1);
    assert.equal(out.texts.get('laning.bad.0')!.source, 'template');
  });
});

describe('createFeedback 결과 모양', () => {
  it('세나 판 FeedbackResult: 영역별 칸, 결정적 장면 3개, meta', async () => {
    const client = new FakeLlmClient([{ text: good }]);
    const run = createFeedbackFromResult({ client, model: 'claude-opus-5-5', effort: 'low', budgetUsd: 1, ledger: memoryLedger(), championNames: NAMES, now: () => 0 });
    const { feedback } = await run(senaResult());
    assert.equal(feedback.mode, 'llm');
    assert.equal(feedback.sections.laning.bad.length, 2);
    assert.equal(feedback.sections.macro.good[0]!.subjectId, 'macro.side');
    assert.equal(feedback.keyMoments.length, 3);
    assert.equal(feedback.meta.engineVersion, '2026-11-11.1');
    assert.equal(feedback.meta.fallbackReason, null);
    assert.equal(feedback.sections.laning.note, undefined);
  });
  it('라인전이 없으면(스냅샷 없는 판) note 한 줄, 키 없으면 전체 템플릿', async () => {
    const run = createFeedbackFromResult({ client: null, model: 'claude-opus-5-5', effort: 'low', budgetUsd: 1, ledger: memoryLedger(), championNames: NAMES, now: () => 0 });
    const { feedback } = await run(secondResult(1));
    assert.equal(feedback.mode, 'template');
    assert.equal(feedback.meta.fallbackReason, 'no_key');
    assert.equal(feedback.sections.laning.note, '이 판은 라인전 상대를 비교할 수 없었습니다.');
    assert.deepEqual(feedback.sections.laning.bad, []);
  });
});
