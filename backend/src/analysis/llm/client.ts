// LLM 클라이언트 (ai_spec 2-3). 이 파일만 @anthropic-ai/sdk를 import한다.
// 근거: Claude API 스킬 문서(typescript/claude-api/README.md, tool-use.md 구조화 출력, shared/prompt-caching.md,
// shared/error-codes.md, shared/model-migration.md "Migrating to Claude Opus 5.5").
// - thinking 필드는 보내지 않는다 (Opus 5.5는 항상 켜짐. disabled·budget_tokens는 400). 깊이는 output_config.effort로.
// - temperature·top_p·top_k·assistant prefill·강제 tool_choice를 쓰지 않는다 (Opus 5.5에서 400).
// - 구조화 출력: output_config.format = { type: "json_schema", schema }. 응답은 type으로 골라 text 블록만 읽는다.
// - stop_reason "refusal"은 내용 읽기 전에 처리. 오류는 SDK 클래스로 분류 (문자열 비교 금지).
import Anthropic from '@anthropic-ai/sdk';
import type { TokenUsage } from './pricing.js';

export type LlmErrorKind =
  | 'auth'
  | 'billing'
  | 'model_not_found'
  | 'bad_request'
  | 'rate'
  | 'server'
  | 'timeout'
  | 'network'
  | 'unknown';

/** 우리 오류 종류. status·type은 로그용 (키·본문은 담지 않는다) */
export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export type LlmEffort = 'low' | 'medium' | 'high';

export interface LlmMessage {
  role: 'user' | 'assistant';
  /** user: 문자열. assistant: 앞 응답의 content 블록 배열을 그대로 (thinking 블록 포함, 수정 금지) */
  content: string | unknown[];
}

export interface LlmRequest {
  model: string;
  effort: LlmEffort;
  system: string;
  messages: LlmMessage[];
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface LlmResponse {
  /** 원본 content 블록 (재시도 때 그대로 돌려보냄, 녹화본에 저장) */
  content: unknown[];
  /** text 블록을 이은 문자열. 없으면 null */
  text: string | null;
  stopReason: string | null;
  stopDetails: unknown;
  usage: TokenUsage;
  model: string;
  durationMs: number;
}

export interface LlmClient {
  create(req: LlmRequest): Promise<LlmResponse>;
}

export interface AnthropicClientOptions {
  apiKey: string;
  timeoutMs?: number;
  maxRetries?: number;
  now?: () => number;
}

export function normalizeUsage(u: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): TokenUsage {
  return {
    input: u.input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    output: u.output_tokens ?? 0,
  };
}

/** 원본 content에서 text 블록만 골라 잇는다 (앞에 thinking 블록이 올 수 있다) */
export function textOf(content: readonly unknown[]): string | null {
  const texts = content
    .filter((b): b is { type: 'text'; text: string } => typeof b === 'object' && b !== null && (b as { type?: unknown }).type === 'text')
    .map((b) => b.text);
  return texts.length > 0 ? texts.join('') : null;
}

/** SDK 오류 → 우리 종류. 가장 구체적인 클래스부터 본다 */
export function classifyError(e: unknown): LlmError {
  if (e instanceof LlmError) return e;
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new LlmError('timeout', '응답 시간 초과');
  if (e instanceof Anthropic.APIConnectionError) return new LlmError('network', '연결 오류');
  if (e instanceof Anthropic.AuthenticationError) return new LlmError('auth', '인증 실패 (401)', 401);
  if (e instanceof Anthropic.PermissionDeniedError) return new LlmError('auth', '권한 없음 (403)', 403);
  if (e instanceof Anthropic.NotFoundError) return new LlmError('model_not_found', '모델 없음 (404)', 404);
  if (e instanceof Anthropic.BadRequestError) return new LlmError('bad_request', `요청 오류 (400): ${e.message}`, 400);
  if (e instanceof Anthropic.RateLimitError) return new LlmError('rate', '호출 한도 (429)', 429);
  if (e instanceof Anthropic.InternalServerError) return new LlmError('server', `서버 오류 (${e.status})`, e.status ?? null);
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402) return new LlmError('billing', '결제·크레딧 문제 (402)', 402);
    if (e.status === 529) return new LlmError('server', '과부하 (529)', 529);
    if (typeof e.status === 'number' && e.status >= 500) return new LlmError('server', `서버 오류 (${e.status})`, e.status);
    return new LlmError('unknown', `API 오류 (${e.status ?? '?'})`, e.status ?? null);
  }
  return new LlmError('unknown', e instanceof Error ? e.message : String(e));
}

/** Anthropic 구현. 키는 명시해 넘긴다 (ANTHROPIC_AUTH_TOKEN이 함께 있으면 401이 나는 문제 회피) */
export function createAnthropicClient(opts: AnthropicClientOptions): LlmClient {
  const sdk = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 60_000, maxRetries: opts.maxRetries ?? 1 });
  const now = opts.now ?? (() => Date.now());
  return {
    async create(req) {
      const t0 = now();
      let msg: Anthropic.Message;
      try {
        msg = await sdk.messages.create({
          model: req.model,
          max_tokens: req.maxTokens,
          system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
          messages: req.messages.map((m) =>
            m.role === 'user'
              ? { role: 'user' as const, content: m.content as string }
              : { role: 'assistant' as const, content: m.content as Anthropic.ContentBlockParam[] },
          ),
          output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
        });
      } catch (e) {
        throw classifyError(e);
      }
      const content = msg.content as unknown[];
      return {
        content,
        text: textOf(content),
        stopReason: msg.stop_reason,
        stopDetails: msg.stop_details ?? null,
        usage: normalizeUsage(msg.usage),
        model: msg.model,
        durationMs: now() - t0,
      };
    },
  };
}
