// 스키마·비용 계산·장부·녹화본 재생·import 경계 (ai_spec 2-5, 2-7, 2-8, 2-11 3번)
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { FakeLlmClient, ReplayLlmClient, requestHash, type RecordedCall, type Recording } from '../../../../src/analysis/llm/fakeClient.js';
import { generateTexts } from '../../../../src/analysis/llm/generate.js';
import { assertBudget, BudgetExceededError, calibration, fileLedger, memoryLedger } from '../../../../src/analysis/llm/ledger.js';
import { costUsd, estimateTokens, worstCallCost } from '../../../../src/analysis/llm/pricing.js';
import { FIRST_SCHEMA, parseFirstAnswer, parseRetryAnswer, RETRY_SCHEMA } from '../../../../src/analysis/llm/schema.js';
import { ALL_NAMES, passingAnswer, senaSheet } from './helpers.js';

const sheet = senaSheet();

describe('스키마', () => {
  it('모든 object가 additionalProperties false이고 모든 필드 required', () => {
    const walk = (s: unknown): void => {
      if (!s || typeof s !== 'object') return;
      const o = s as Record<string, unknown>;
      if (o.type === 'object') {
        assert.equal(o.additionalProperties, false);
        assert.deepEqual([...(o.required as string[])].sort(), Object.keys(o.properties as object).sort());
      }
      for (const v of Object.values(o)) walk(v);
    };
    walk(FIRST_SCHEMA);
    walk(RETRY_SCHEMA);
  });
  it('모양 검사: 맞는 답은 통과, 모양이 틀리면 null', () => {
    assert.ok(parseFirstAnswer(JSON.stringify(passingAnswer(sheet))));
    assert.equal(parseFirstAnswer('{"summary":{"text":"a"}}'), null);
    assert.equal(parseFirstAnswer('not json'), null);
    assert.deepEqual(parseRetryAnswer('{"fixes":[{"slot":"summary","text":"t","factIds":[]}]}'), { fixes: [{ slot: 'summary', text: 't', factIds: [] }] });
    assert.equal(parseRetryAnswer('{"fixes":[{"slot":1}]}'), null);
  });
});

describe('비용 계산', () => {
  it('Opus 5.5: 입력 $4, 캐시 쓰기 $5, 캐시 읽기 $0.20, 출력 $20 per 1M', () => {
    assert.ok(Math.abs(costUsd({ input: 1_000_000, cacheWrite: 0, cacheRead: 0, output: 0 }, 'claude-opus-5-5') - 4) < 1e-9);
    assert.ok(Math.abs(costUsd({ input: 0, cacheWrite: 1_000_000, cacheRead: 1_000_000, output: 1_000_000 }, 'claude-opus-5-5') - 25.2) < 1e-9);
  });
  it('최악 비용 = 입력 × 캐시 쓰기 단가 + max_tokens 전부 × 출력 단가', () => {
    assert.ok(Math.abs(worstCallCost(4000, 4000, 'claude-opus-5-5') - (4000 * 5 + 4000 * 20) / 1e6) < 1e-12);
  });
  it('모르는 모델은 오류', () => {
    assert.throws(() => costUsd({ input: 1, cacheWrite: 0, cacheRead: 0, output: 0 }, 'gpt-x'));
  });
  it('토큰 어림: 한글 1글자 ≈ 1, 그 밖 3글자 ≈ 1, 보정 계수 적용', () => {
    assert.equal(estimateTokens('가나다abc'), 4);
    assert.equal(estimateTokens('가나다abc', 0.5), 2);
  });
});

describe('장부', () => {
  const entry = (cost: number, kind: 'first' | 'retry' = 'first') => ({
    at: '2026-11-03T00:00:00.000Z',
    matchId: 'KR_1',
    participantId: 1,
    model: 'claude-opus-5-5',
    effort: 'low',
    promptVersion: 'v',
    attempt: 1,
    kind,
    estInputTokens: 2000,
    usage: { input: 1000, cacheWrite: 500, cacheRead: 0, output: 800 },
    stopReason: 'end_turn',
    costUsd: cost,
    durationMs: 10,
    recording: null,
    error: null,
  });
  it('파일 장부: 한 줄씩 쌓이고 누적 합계를 낸다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const l = fileLedger(join(dir, 'sub', 'ledger.jsonl'));
    assert.equal(l.totalUsd(), 0);
    l.append(entry(0.1));
    l.append(entry(0.05));
    assert.ok(Math.abs(l.totalUsd() - 0.15) < 1e-12);
    assert.equal(readFileSync(join(dir, 'sub', 'ledger.jsonl'), 'utf8').trim().split('\n').length, 2);
  });
  it('예산: 누적 + 최악 > 상한이면 BudgetExceededError', () => {
    const l = memoryLedger([entry(0.81)]);
    assert.throws(() => assertBudget(l, 0.2, 1), BudgetExceededError);
    assert.doesNotThrow(() => assertBudget(l, 0.19, 1));
  });
  it('보정: 실측 입력(입력+캐시) ÷ 어림, 평균 출력 (재시도는 빼고)', () => {
    const c = calibration([entry(0.1), entry(0.1, 'retry')], 'claude-opus-5-5', 'v');
    assert.equal(c.inputFactor, 0.75);
    assert.equal(c.avgOutput, 800);
    assert.equal(c.samples, 1);
  });
  it('보정: 장부 어림은 계수를 곱한 값이라 계수로 되돌려 계산한다 (이중 보정 방지, Review 2026-11-03)', () => {
    // 보정 전 어림 1000, 실측 1500인 같은 요청 3번. 2·3번째는 계수 1.5를 곱해 1500으로 적혀 있다
    const e = (est: number, inputFactor?: number) => ({ ...entry(0.1), estInputTokens: est, usage: { input: 1500, cacheWrite: 0, cacheRead: 0, output: 800 }, ...(inputFactor ? { inputFactor } : {}) });
    assert.equal(calibration([e(1000, 1), e(1500, 1.5), e(1500, 1.5)], 'claude-opus-5-5', 'v').inputFactor, 1.5);
    // inputFactor가 없는 옛 줄: 당시 계수(앞 줄들의 실측 ÷ 장부 어림)를 다시 구해 되돌린다
    assert.equal(calibration([e(1000), e(1500)], 'claude-opus-5-5', 'v').inputFactor, 1.5);
  });
  it('보정: 실제 2단계 장부(8줄)의 계수는 약 1.64 (이중 보정이면 1.28)', () => {
    const path = fileURLToPath(new URL('../../../eval/usage-ledger.jsonl', import.meta.url));
    const c = calibration(fileLedger(path).entries(), 'claude-opus-5-5', '2026-11-03.1');
    assert.equal(c.samples, 6);
    assert.ok(Math.abs(c.inputFactor - 1.645) < 0.005, `${c.inputFactor}`);
  });
});

describe('녹화본 재생 (0원)', () => {
  it('가짜 응답을 녹화한 뒤 재생하면 같은 결과, 요청 해시 일치', async () => {
    const wrong = passingAnswer(sheet);
    wrong.sections.laning.bad[0]!.text = '골드가 800 적었습니다.';
    const fix = { fixes: [{ slot: 'laning.bad.0', text: '15분 골드가 상대 애쉬보다 703 적었습니다.', factIds: ['laning.referenceMin', 'laning.opponent', 'laning.gold.diffAbs'] }] };
    const calls: RecordedCall[] = [];
    const base = { model: 'claude-opus-5-5', effort: 'low' as const, budgetUsd: 1, allChampionNames: ALL_NAMES, now: () => 0 };
    const live = await generateTexts(sheet, {
      ...base,
      client: new FakeLlmClient([{ text: JSON.stringify(wrong) }, { text: JSON.stringify(fix) }]),
      ledger: memoryLedger(),
      onCall: (c) => calls.push(c),
    });
    const rec: Recording = { matchId: sheet.matchId, participantId: 5, engineVersion: '', promptVersion: '', model: base.model, effort: 'low', recordedAt: '', calls };
    const replay = new ReplayLlmClient(JSON.parse(JSON.stringify(rec)) as Recording);
    const again = await generateTexts(sheet, { ...base, client: replay, ledger: memoryLedger() });
    assert.deepEqual(replay.mismatches, []);
    assert.deepEqual([...again.texts], [...live.texts]);
    assert.deepEqual(again.verification, live.verification);
    assert.equal(calls.length, 2);
    assert.equal(typeof requestHash, 'function');
  });
});

describe('import 경계', () => {
  const src = fileURLToPath(new URL('../../../../src/', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : []));
  it('@anthropic-ai/sdk는 analysis/llm/client.ts만 import', () => {
    const users = files(src).filter((f) => /from '@anthropic-ai\/sdk/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(users.map((f) => f.slice(src.length)), ['analysis/llm/client.ts']);
  });
  it('analysis/**는 riot·db·repositories를 import하지 않고 process.env를 읽지 않는다', () => {
    for (const f of files(join(src, 'analysis'))) {
      const t = readFileSync(f, 'utf8');
      assert.doesNotMatch(t, /from '\.\.?\/(\.\.\/)*(riot|db|repositories)\//, f);
      assert.doesNotMatch(t, /process\.env/, f);
    }
  });
});
