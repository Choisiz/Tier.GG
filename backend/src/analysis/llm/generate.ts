// 1차 호출 → 검증 → 재시도 1회(고칠 칸만) → 그래도 틀린 칸은 템플릿 (ai_spec 2-0, 2-3, 2-6).
// RAG 조각(deps.knowledge)이 있으면 시스템 프롬프트 뒤 규칙·<knowledge> 블록·chunkIds 스키마를 쓰고, 없으면 Q1과 같은 요청이다 (B4).
import { LlmError, type LlmClient, type LlmEffort, type LlmMessage, type LlmRequest, type LlmResponse } from './client.js';
import type { RecordedCall } from './fakeClient.js';
import { requestHash } from './fakeClient.js';
import type { FactSheet } from './facts.js';
import { assertBudget, BudgetExceededError, type Ledger, type LedgerEntry } from './ledger.js';
import { addUsage, costUsd, estimateTokens, worstCallCost, ZERO_USAGE, type TokenUsage } from './pricing.js';
import { buildRetryMessage, buildUserMessage, promptVersionFor, systemPromptFor, type KnowledgeChunkInput } from './prompt.js';
import { firstSchemaFor, parseFirstAnswer, parseRetryAnswer, retrySchemaFor } from './schema.js';
import { templateFor } from './template.js';
import { checkFirstAnswer, checkRetryAnswer, type SlotText, type VerifyContext, type VerifyFailure } from './verify.js';

export const MAX_TOKENS = { first: 3000, retry: 1500 } as const;

export type FallbackReason =
  | 'no_key'
  | 'auth'
  | 'billing'
  | 'model_not_found'
  | 'bad_request'
  | 'rate'
  | 'server'
  | 'timeout'
  | 'network'
  | 'unknown'
  | 'refusal'
  | 'max_tokens'
  | 'parse'
  | 'verify'
  | 'budget';

export type TextSource = 'llm' | 'llm_retry' | 'template';

export interface FinalText extends SlotText {
  source: TextSource;
}

export interface GenerateDeps {
  /** null = 키 없음 → 전체 템플릿 */
  client: LlmClient | null;
  model: string;
  effort: LlmEffort;
  budgetUsd: number;
  ledger: Ledger;
  allChampionNames: readonly string[];
  now: () => number;
  /** 입력 토큰 어림 보정 계수 (장부 실측) */
  inputFactor?: number;
  maxTokens?: { first: number; retry: number };
  /** 호출마다 녹화본·장부 파일 이름 등을 남기기 위한 콜백 */
  onCall?: (call: RecordedCall) => void;
  /** 장부 항목의 recording 칸 */
  recordingName?: string | null;
  /** RAG 조각 (B4). null·빈 배열이면 RAG 없이 (Q1과 같은 요청) */
  knowledge?: readonly KnowledgeChunkInput[] | null;
}

export interface GenerateOutcome {
  mode: 'llm' | 'template';
  fallbackReason: FallbackReason | null;
  texts: Map<string, FinalText>;
  attempts: number;
  verification: {
    firstPass: number;
    firstTotal: number;
    /** 1차 답에서 숫자 검사를 통과한 칸 수 */
    numberFirstPass: number;
    retried: number;
    templated: number;
    failures: VerifyFailure[];
    retryFailures: VerifyFailure[];
    extras: VerifyFailure[];
  };
  usage: TokenUsage;
  costUsd: number;
  durationMs: number;
  stopDetails: unknown;
  /** 이 생성에 쓴 프롬프트 버전 (조각 유무로 다름) */
  promptVersion: string;
  /** 프롬프트에 준 조각 ID (RAG 없으면 빈 배열) */
  knowledgeIds: string[];
}

type CallResult = { ok: true; res: LlmResponse } | { ok: false; reason: FallbackReason; error?: LlmError };

export async function generateTexts(sheet: FactSheet, deps: GenerateDeps): Promise<GenerateOutcome> {
  const t0 = deps.now();
  const maxTokens = deps.maxTokens ?? MAX_TOKENS;
  const knowledge = deps.knowledge && deps.knowledge.length > 0 ? deps.knowledge : null;
  const rag = knowledge !== null;
  const promptVersion = promptVersionFor(rag);
  const knowledgeIds = knowledge ? knowledge.map((c) => c.id) : [];
  const vctx: VerifyContext = { sheet, allChampionNames: deps.allChampionNames, ...(rag ? { knowledgeIds: new Set(knowledgeIds) } : {}) };
  let usage = ZERO_USAGE;
  let cost = 0;
  let attempts = 0;
  let stopDetails: unknown = null;

  const allTemplate = (reason: FallbackReason): GenerateOutcome => {
    const texts = new Map<string, FinalText>();
    for (const s of sheet.slots) texts.set(s.slot, { ...templateFor(sheet, s), source: 'template' });
    return {
      mode: 'template',
      fallbackReason: reason,
      texts,
      attempts,
      verification: { firstPass: 0, firstTotal: sheet.slots.length, numberFirstPass: 0, retried: 0, templated: sheet.slots.length, failures: [], retryFailures: [], extras: [] },
      usage,
      costUsd: cost,
      durationMs: deps.now() - t0,
      stopDetails,
      promptVersion,
      knowledgeIds,
    };
  };

  if (!deps.client) return allTemplate('no_key');
  const client = deps.client;

  const call = async (kind: RecordedCall['kind'], attempt: number, req: LlmRequest): Promise<CallResult> => {
    const est = estimateTokens(req.system + JSON.stringify(req.messages), deps.inputFactor ?? 1);
    try {
      assertBudget(deps.ledger, worstCallCost(est, req.maxTokens, req.model), deps.budgetUsd);
    } catch (e) {
      if (e instanceof BudgetExceededError) return { ok: false, reason: 'budget' };
      throw e;
    }
    attempts++;
    const hash = requestHash(req);
    const base: Omit<LedgerEntry, 'usage' | 'stopReason' | 'costUsd' | 'durationMs' | 'error'> = {
      at: new Date(deps.now()).toISOString(),
      matchId: sheet.matchId,
      participantId: sheet.participantId,
      model: req.model,
      effort: req.effort,
      promptVersion,
      attempt,
      kind,
      estInputTokens: est,
      inputFactor: deps.inputFactor ?? 1,
      recording: deps.recordingName ?? null,
    };
    try {
      const res = await client.create(req);
      const c = costUsd(res.usage, req.model);
      usage = addUsage(usage, res.usage);
      cost += c;
      deps.ledger.append({ ...base, usage: res.usage, stopReason: res.stopReason, costUsd: c, durationMs: res.durationMs, error: null });
      deps.onCall?.({
        attempt,
        kind,
        requestHash: hash,
        response: { content: res.content, stopReason: res.stopReason, stopDetails: res.stopDetails, usage: res.usage, model: res.model },
        error: null,
        durationMs: res.durationMs,
      });
      return { ok: true, res };
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      // 오류 응답은 usage가 없어 비용 0으로 남긴다 (SDK 재시도 포함 1건)
      deps.ledger.append({ ...base, usage: ZERO_USAGE, stopReason: null, costUsd: 0, durationMs: 0, error: `${e.kind}: ${e.message}` });
      deps.onCall?.({ attempt, kind, requestHash: hash, response: null, error: { kind: e.kind, message: e.message, status: e.status }, durationMs: 0 });
      return { ok: false, reason: e.kind, error: e };
    }
  };

  const firstMessages: LlmMessage[] = [{ role: 'user', content: buildUserMessage(sheet, knowledge) }];
  const firstReq: LlmRequest = {
    model: deps.model,
    effort: deps.effort,
    system: systemPromptFor(rag),
    messages: firstMessages,
    schema: firstSchemaFor(rag),
    maxTokens: maxTokens.first,
  };

  // ---------- 1차 (파싱 실패면 전체를 한 번 더) ----------
  let first: CallResult = await call('first', 1, firstReq);
  if (!first.ok) return allTemplate(first.reason);
  const stopFail = (r: LlmResponse): FallbackReason | null => {
    if (r.stopReason === 'refusal') {
      stopDetails = r.stopDetails;
      return 'refusal';
    }
    if (r.stopReason === 'max_tokens') return 'max_tokens';
    return null;
  };
  let sf = stopFail(first.res);
  if (sf) return allTemplate(sf);
  let answer = first.res.text !== null ? parseFirstAnswer(first.res.text) : null;
  if (!answer) {
    first = await call('first_again', 2, firstReq);
    if (!first.ok) return allTemplate(first.reason === 'budget' ? 'budget' : first.reason);
    sf = stopFail(first.res);
    if (sf) return allTemplate(sf);
    answer = first.res.text !== null ? parseFirstAnswer(first.res.text) : null;
    if (!answer) return allTemplate('parse');
  }
  const firstRes = first.res;

  // ---------- 검증 ----------
  const check = checkFirstAnswer(answer, vctx);
  const texts = new Map<string, FinalText>();
  for (const slotId of check.passed) texts.set(slotId, { ...check.texts.get(slotId)!, source: 'llm' });
  const failedSlots = sheet.slots.map((s) => s.slot).filter((id) => !check.passed.has(id));
  const numberFailed = new Set(check.failures.filter((f) => f.rule === 'number').map((f) => f.slot));
  const verification: GenerateOutcome['verification'] = {
    firstPass: check.passed.size,
    firstTotal: sheet.slots.length,
    numberFirstPass: sheet.slots.filter((s) => check.texts.has(s.slot) && !numberFailed.has(s.slot)).length,
    retried: 0,
    templated: 0,
    failures: check.failures,
    retryFailures: [],
    extras: check.extras,
  };

  // ---------- 재시도 1회 (고칠 칸만, 앞 대화에 덧붙임) ----------
  if (failedSlots.length > 0) {
    verification.retried = failedSlots.length;
    const retryReq: LlmRequest = {
      ...firstReq,
      messages: [
        ...firstMessages,
        { role: 'assistant', content: firstRes.content },
        { role: 'user', content: buildRetryMessage(sheet, check.failures.filter((f) => failedSlots.includes(f.slot)), rag) },
      ],
      schema: retrySchemaFor(rag),
      maxTokens: maxTokens.retry,
    };
    const retry = await call('retry', 2, retryReq);
    if (retry.ok && !stopFail(retry.res) && retry.res.text !== null) {
      const ra = parseRetryAnswer(retry.res.text);
      if (ra) {
        const rc = checkRetryAnswer(ra, failedSlots, vctx);
        verification.retryFailures = rc.failures;
        for (const id of rc.passed) texts.set(id, { ...rc.texts.get(id)!, source: 'llm_retry' });
      } else {
        verification.retryFailures = [{ slot: 'retry', rule: 'shape', detail: '재시도 답 JSON 모양 오류' }];
      }
    } else {
      const why = retry.ok ? (stopFail(retry.res) ?? 'parse') : retry.reason;
      verification.retryFailures = [{ slot: 'retry', rule: 'shape', detail: `재시도 실패: ${why}` }];
    }
  }

  // ---------- 남은 칸은 템플릿 ----------
  for (const s of sheet.slots) {
    if (!texts.has(s.slot)) {
      texts.set(s.slot, { ...templateFor(sheet, s), source: 'template' });
      verification.templated++;
    }
  }

  const anyLlm = [...texts.values()].some((t) => t.source !== 'template');
  return {
    mode: anyLlm ? 'llm' : 'template',
    fallbackReason: anyLlm ? null : 'verify',
    texts,
    attempts,
    verification,
    usage,
    costUsd: cost,
    durationMs: deps.now() - t0,
    stopDetails,
    promptVersion,
    knowledgeIds,
  };
}
