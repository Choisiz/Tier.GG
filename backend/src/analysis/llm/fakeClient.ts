// 0원 개발용 클라이언트 (ai_spec 2-7): 단위 테스트용 가짜 클라이언트와 녹화본 재생 클라이언트.
import { createHash } from 'node:crypto';
import { LlmError, textOf, type LlmClient, type LlmErrorKind, type LlmRequest, type LlmResponse } from './client.js';
import { ZERO_USAGE, type TokenUsage } from './pricing.js';

// ---------- 녹화본 ----------

export interface RecordedCall {
  attempt: number;
  kind: 'first' | 'retry' | 'first_again';
  /** 요청(모델·effort·시스템·메시지·스키마·max_tokens)의 sha256. 재생 때 같은 요청인지 확인 */
  requestHash: string;
  response: { content: unknown[]; stopReason: string | null; stopDetails: unknown; usage: TokenUsage; model: string } | null;
  error: { kind: LlmErrorKind; message: string; status: number | null } | null;
  durationMs: number;
}

export interface Recording {
  matchId: string;
  participantId: number;
  engineVersion: string;
  promptVersion: string;
  model: string;
  effort: string;
  recordedAt: string;
  calls: RecordedCall[];
}

export function requestHash(req: LlmRequest): string {
  return createHash('sha256')
    .update(JSON.stringify([req.model, req.effort, req.system, req.messages, req.schema, req.maxTokens]))
    .digest('hex');
}

// ---------- 가짜 클라이언트 ----------

export type FakeStep =
  | { text: string; stopReason?: string; usage?: Partial<TokenUsage>; content?: unknown[] }
  | { error: LlmErrorKind; status?: number }
  | { refusal: true; category?: string };

/** 정해 둔 응답·오류를 순서대로 돌려준다. 받은 요청은 requests에 남는다 */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private i = 0;

  constructor(private readonly steps: FakeStep[]) {}

  get calls(): number {
    return this.requests.length;
  }

  async create(req: LlmRequest): Promise<LlmResponse> {
    this.requests.push(structuredClone(req));
    const step = this.steps[this.i++];
    if (!step) throw new Error(`FakeLlmClient: 준비한 응답이 없음 (${this.i}번째 호출)`);
    if ('error' in step) throw new LlmError(step.error, `가짜 오류 ${step.error}`, step.status ?? null);
    const usage: TokenUsage = { ...ZERO_USAGE, input: 1000, output: 500 };
    if ('refusal' in step) {
      return { content: [], text: null, stopReason: 'refusal', stopDetails: { category: step.category ?? null }, usage, model: req.model, durationMs: 1 };
    }
    const content = step.content ?? [{ type: 'thinking', thinking: '', signature: 'fake' }, { type: 'text', text: step.text }];
    return {
      content,
      text: textOf(content),
      stopReason: step.stopReason ?? 'end_turn',
      stopDetails: null,
      usage: { ...usage, ...step.usage },
      model: req.model,
      durationMs: 1,
    };
  }
}

// ---------- 녹화본 재생 ----------

/** 녹화본의 호출을 순서대로 다시 돌려준다 (0원). 요청 해시가 다르면 mismatches에 남긴다 */
export class ReplayLlmClient implements LlmClient {
  readonly mismatches: number[] = [];
  private i = 0;

  constructor(private readonly recording: Recording) {}

  async create(req: LlmRequest): Promise<LlmResponse> {
    const call = this.recording.calls[this.i++];
    if (!call) throw new LlmError('unknown', `녹화본에 ${this.i}번째 호출이 없음 (프롬프트·검증 흐름이 녹화 때와 다름)`);
    if (call.requestHash !== requestHash(req)) this.mismatches.push(this.i);
    if (call.error) throw new LlmError(call.error.kind, call.error.message, call.error.status);
    const r = call.response!;
    return { content: r.content, text: textOf(r.content), stopReason: r.stopReason, stopDetails: r.stopDetails, usage: r.usage, model: r.model, durationMs: call.durationMs };
  }
}
