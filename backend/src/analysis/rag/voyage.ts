// Voyage AI 임베딩 (ai_spec B4-3). 외부 임베딩 호출은 이 파일에서만 한다. 새 의존성 없이 Node 내장 fetch.
// 키는 인자로 받는다 (환경 변수는 CLI·API 진입점에서만 읽는다). 키·본문은 오류 메시지·로그에 넣지 않는다.
export const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
export const VOYAGE_MODEL = 'voyage-4';
/** 계약 v9: rag_chunk.embedding = extensions.vector(1024) */
export const VOYAGE_DIM = 1024;
/** 요청 1번에 넣는 문장 수 상한 (Voyage 한도보다 작게) */
export const VOYAGE_BATCH = 64;
export const VOYAGE_TIMEOUT_MS = 15_000;

export type EmbedInputType = 'document' | 'query';
/** 문장들 → 같은 순서의 벡터들. 검색·적재 코드는 이 모양만 안다 (테스트는 가짜 함수) */
export type EmbedFn = (texts: readonly string[], inputType: EmbedInputType) => Promise<number[][]>;

export type VoyageErrorKind = 'auth' | 'rate' | 'bad_request' | 'server' | 'timeout' | 'network' | 'shape';

export class VoyageError extends Error {
  constructor(
    readonly kind: VoyageErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'VoyageError';
  }
}

export interface VoyageOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  batchSize?: number;
  /** 테스트에서 바꿔 끼운다 */
  fetchFn?: typeof fetch;
  /** 사용 토큰 합계를 받는다 (CLI 출력용) */
  onUsage?: (tokens: number) => void;
  /** 429(분당 한도)일 때 기다렸다 다시 보내는 횟수. 기본 0 (API는 3초 상한이라 재시도하지 않음, CLI만 씀) */
  rateRetries?: number;
  /** 429 재시도 대기 (Retry-After 헤더가 없을 때). 기본 21초 (무료 등급 분당 3회 기준) */
  rateWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function kindOf(status: number): VoyageErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** Voyage 임베딩 함수를 만든다. 문장이 많으면 batchSize씩 나눠 순서대로 보낸다 */
export function createVoyageEmbed(o: VoyageOptions): EmbedFn {
  const model = o.model ?? VOYAGE_MODEL;
  const timeoutMs = o.timeoutMs ?? VOYAGE_TIMEOUT_MS;
  const batch = o.batchSize ?? VOYAGE_BATCH;
  const f = o.fetchFn ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (texts, inputType) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += batch) {
      const input = texts.slice(i, i + batch);
      let res: Response;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await f(VOYAGE_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
            body: JSON.stringify({ input, model, input_type: inputType, output_dimension: VOYAGE_DIM }),
            signal: AbortSignal.timeout(timeoutMs),
          });
        } catch (e) {
          const name = e instanceof Error ? e.name : '';
          if (name === 'TimeoutError' || name === 'AbortError') throw new VoyageError('timeout', `Voyage 응답 시간 초과 (${timeoutMs}ms)`);
          throw new VoyageError('network', 'Voyage 연결 실패');
        }
        if (res.status !== 429 || attempt >= (o.rateRetries ?? 0)) break;
        const after = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : (o.rateWaitMs ?? 21_000));
      }
      if (!res.ok) throw new VoyageError(kindOf(res.status), `Voyage HTTP ${res.status}`, res.status);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new VoyageError('shape', 'Voyage 응답이 JSON이 아님');
      }
      const data = (json as { data?: unknown }).data;
      if (!Array.isArray(data) || data.length !== input.length) throw new VoyageError('shape', 'Voyage 응답 data 개수가 요청과 다름');
      const sorted = [...(data as { index?: unknown; embedding?: unknown }[])].sort((a, b) => Number(a.index) - Number(b.index));
      for (const d of sorted) {
        const v = d.embedding;
        if (!Array.isArray(v) || v.length !== VOYAGE_DIM || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
          throw new VoyageError('shape', `Voyage 벡터가 ${VOYAGE_DIM}차원 숫자 배열이 아님`);
        }
        out.push(v as number[]);
      }
      const tokens = (json as { usage?: { total_tokens?: unknown } }).usage?.total_tokens;
      if (typeof tokens === 'number') o.onUsage?.(tokens);
    }
    return out;
  };
}

/** pgvector 리터럴 '[0.1,0.2,…]' (계약 12-1: $1::extensions.vector로 넘긴다) */
export function toVectorLiteral(v: readonly number[]): string {
  return `[${v.join(',')}]`;
}

/** 적재 미리보기용 토큰 어림 (한국어는 대략 글자 수 정도. 실제 값은 적재 때 usage로 확인) */
export function estimateEmbedTokens(texts: readonly string[]): number {
  return texts.reduce((s, t) => s + t.length, 0);
}
