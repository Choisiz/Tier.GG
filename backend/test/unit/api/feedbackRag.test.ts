// 피드백 서비스 + RAG (ai_spec B4-4): 꺼짐이면 이전과 같음, 켜지면 조각을 LLM에 주고 meta.knowledgeVersion을 채움,
// 검색 실패·시간 초과면 RAG 없이 진행(로그만), LLM 꺼짐이면 검색하지 않음. 가짜 검색·가짜 LLM만, 유료 호출 0회.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PROMPT_VERSION_NO_RAG, SYSTEM_PROMPT } from '../../../src/analysis/llm/prompt.js';
import type { RetrieveOutcome } from '../../../src/analysis/rag/retrieve.js';
import type { FeedbackRagConfig } from '../../../src/api/feedback/service.js';
import { harness, ScriptClient, SENA_ID, SENA_PUUID } from './feedbackHelpers.js';

const OUT: RetrieveOutcome = {
  chunks: [{ id: 'fight.vision.SUPPORT_DAMAGE.bad.01', content: '딜서폿의 오브젝트 전 시야가 낮을 때\n시야가 부족했을 수 있다. 와드를 먼저 두어 볼 수 있다.', distance: 0.1 }],
  picks: [{ key: 'fight.bad.0', subjectId: 'fight.vision', ids: ['fight.vision.SUPPORT_DAMAGE.bad.01'], widened: false }],
  queries: 7,
  notes: [],
};

function rag(retrieve: FeedbackRagConfig['retrieve'], timeoutMs = 50): FeedbackRagConfig & { calls: number } {
  const r = {
    calls: 0,
    knowledgeVersion: 'abc123def456',
    timeoutMs,
    retrieve: async (x: Parameters<FeedbackRagConfig['retrieve']>[0]) => {
      r.calls++;
      return retrieve(x);
    },
  };
  return r;
}

describe('피드백 서비스 + RAG', () => {
  it('RAG 꺼짐(설정 없음): knowledgeVersion null, promptVersion .1, Q1 시스템 프롬프트, 조각 블록 없음', async () => {
    const h = harness();
    const dto = await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(dto.meta.knowledgeVersion, null);
    assert.equal(dto.meta.promptVersion, PROMPT_VERSION_NO_RAG);
    const req = h.client!.requests[0]!;
    assert.equal(req.system, SYSTEM_PROMPT);
    assert.doesNotMatch(String(req.messages[0]!.content), /<knowledge>/);
  });

  it('RAG 켜짐: 검색 1번, LLM 요청에 <knowledge>, 응답 meta.knowledgeVersion·promptVersion .2, 응답에 chunkIds 키 없음', async () => {
    const r = rag(async () => OUT);
    const h = harness({ rag: r });
    const dto = await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(r.calls, 1);
    assert.equal(dto.mode, 'llm');
    assert.equal(dto.meta.knowledgeVersion, 'abc123def456');
    assert.equal(dto.meta.promptVersion, '2026-11-10.2');
    const req = h.client!.requests[0]!;
    assert.ok(req.system.length > SYSTEM_PROMPT.length);
    assert.match(String(req.messages[0]!.content), /<chunk id="fight\.vision\.SUPPORT_DAMAGE\.bad\.01">/);
    assert.doesNotMatch(JSON.stringify(dto), /chunkIds|knowledgeIds/);
    assert.ok(h.logs.some((l) => l.msg === 'RAG 검색' && l.fields?.chunks === 1));
    // 같은 키 두 번째는 캐시 (검색·LLM 다시 안 함)
    await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(r.calls, 1);
    assert.equal(h.client!.calls, 1);
  });

  it('검색 0개: RAG 없이 (.1, knowledgeVersion null)', async () => {
    const h = harness({ rag: rag(async () => ({ ...OUT, chunks: [], notes: ['조각 0개 → RAG 없이 생성'] })) });
    const dto = await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(dto.meta.knowledgeVersion, null);
    assert.equal(dto.meta.promptVersion, PROMPT_VERSION_NO_RAG);
    assert.equal(h.client!.requests[0]!.system, SYSTEM_PROMPT);
  });

  it('검색 실패·시간 초과: 200 그대로 RAG 없이 생성, 경고 로그, 긴 결과 캐시에 넣지 않음', async () => {
    for (const retrieve of [async () => Promise.reject(new Error('DB down')), () => new Promise<RetrieveOutcome>(() => {})]) {
      const r = rag(retrieve, 20);
      const h = harness({ rag: r });
      const dto = await h.feedback(SENA_ID, SENA_PUUID);
      assert.equal(dto.mode, 'llm');
      assert.equal(dto.meta.knowledgeVersion, null);
      assert.equal(h.client!.requests[0]!.system, SYSTEM_PROMPT);
      assert.ok(h.logs.some((l) => l.level === 'warn' && /RAG 검색 실패/.test(l.msg)));
      // 짧은 템플릿 캐시에만: 10분 뒤 다시 누르면 다시 검색한다
      h.clock.t += 11 * 60 * 1000;
      await h.feedback(SENA_ID, SENA_PUUID);
      assert.equal(r.calls, 2);
    }
  });

  it('LLM 꺼짐(템플릿): 검색하지 않음, knowledgeVersion null', async () => {
    const r = rag(async () => OUT);
    const h = harness({ client: null, rag: r });
    const dto = await h.feedback(SENA_ID, SENA_PUUID);
    assert.equal(dto.mode, 'template');
    assert.equal(r.calls, 0);
    assert.equal(dto.meta.knowledgeVersion, null);
  });

  it('RAG 켜짐과 꺼짐은 캐시 키가 다르다 (knowledgeVersion·promptVersion이 키에 들어감)', async () => {
    const shared = new ScriptClient();
    const off = harness({ client: shared });
    const on = harness({ client: shared, rag: rag(async () => OUT) });
    await off.feedback(SENA_ID, SENA_PUUID);
    await on.feedback(SENA_ID, SENA_PUUID);
    assert.equal(shared.calls, 2);
  });
});
