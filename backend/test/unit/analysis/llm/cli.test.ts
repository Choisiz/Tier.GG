// CLI 미리보기 (ai_spec 2-8): 플래그 없이 실행하면 클라이언트를 만들지 않고 비용만 출력한다
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { runCli, type CliDeps } from '../../../../src/cli/feedback.js';
import { FakeLlmClient } from '../../../../src/analysis/llm/fakeClient.js';
import { passingAnswer, senaSheet } from './helpers.js';

const fx = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const ARGS = ['--match', `${fx}KR_8437852704.match.json`, '--timeline', `${fx}KR_8437852704.timeline.json`, '--participant', '5'];

function harness(factory?: CliDeps['clientFactory']) {
  const out: string[] = [];
  const err: string[] = [];
  let made = 0;
  const deps: CliDeps = {
    clientFactory: (k) => {
      made++;
      if (!factory) throw new Error('클라이언트를 만들면 안 됨');
      return factory(k);
    },
    now: () => Date.UTC(2026, 10, 3),
  };
  return { out, err, deps, io: { log: (s: string) => out.push(s), error: (s: string) => err.push(s) }, made: () => made };
}

describe('CLI 미리보기', () => {
  it('플래그 없음: 클라이언트 0개, 키가 있어도 값은 출력하지 않음, 예상·최악 비용과 장부 잔액 출력', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-'));
    const h = harness();
    const code = await runCli([...ARGS, '--ledger', join(dir, 'l.jsonl'), '--out', join(dir, 'out')], { ANTHROPIC_API_KEY: 'sk-secret-value' }, h.io, h.deps);
    assert.equal(code, 0);
    assert.equal(h.made(), 0);
    const text = h.out.join('\n');
    assert.match(text, /예상 \$\d+\.\d{4}, 최악 \$\d+\.\d{4}/);
    assert.match(text, /남은 예산 \$1\.0000/);
    assert.match(text, /미리보기만/);
    assert.doesNotMatch(text + h.err.join('\n'), /sk-secret-value/);
    assert.deepEqual(readdirSync(dir), []); // 장부·결과 파일도 만들지 않음
  });
  it('--yes인데 키 없음: 호출하지 않고 종료 코드 1', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-'));
    const h = harness();
    const code = await runCli([...ARGS, '--yes', '--ledger', join(dir, 'l.jsonl')], {}, h.io, h.deps);
    assert.equal(code, 1);
    assert.equal(h.made(), 0);
  });
  it('--yes인데 예산 상한이 작으면 클라이언트를 만들지 않고 종료 코드 3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-'));
    const h = harness();
    const code = await runCli([...ARGS, '--yes', '--ledger', join(dir, 'l.jsonl')], { ANTHROPIC_API_KEY: 'k', FEEDBACK_BUDGET_USD: '0.01' }, h.io, h.deps);
    assert.equal(code, 3);
    assert.equal(h.made(), 0);
  });
  it('--yes (가짜 클라이언트): 장부 1줄·녹화본·결과 파일, 녹화본에 키·puuid 없음 → --replay가 같은 결과', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-'));
    const good = JSON.stringify(passingAnswer(senaSheet()));
    const h = harness(() => new FakeLlmClient([{ text: good }]));
    const common = ['--ledger', join(dir, 'l.jsonl'), '--out', join(dir, 'out'), '--recordings', join(dir, 'rec')];
    const code = await runCli([...ARGS, '--yes', ...common], { ANTHROPIC_API_KEY: 'sk-secret-value' }, h.io, h.deps);
    assert.equal(code, 0);
    assert.equal(h.made(), 1);
    assert.equal(readFileSync(join(dir, 'l.jsonl'), 'utf8').trim().split('\n').length, 1);
    const recs = readdirSync(join(dir, 'rec'));
    assert.equal(recs.length, 1);
    assert.match(recs[0]!, /^KR_8437852704\.p5\.[\d.-]+\.claude-opus-5-5\.low\.json$/);
    const rec = readFileSync(join(dir, 'rec', recs[0]!), 'utf8');
    assert.doesNotMatch(rec, /sk-secret-value|TEST_PUUID|puuid/);
    const r = harness();
    const code2 = await runCli([...ARGS, '--replay', join(dir, 'rec'), ...common], {}, r.io, r.deps);
    assert.equal(code2, 0);
    assert.equal(r.made(), 0);
    assert.match(r.out.join('\n'), /1차 통과 11\/11/);
    assert.equal(readFileSync(join(dir, 'l.jsonl'), 'utf8').trim().split('\n').length, 1); // 재생은 장부에 안 남김
  });
});
