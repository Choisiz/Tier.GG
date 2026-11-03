// 모델별 가격표와 비용 계산 (ai_spec 2-8, 2-10).
// 가격은 참고값이다: Claude API 스킬 문서(model-migration.md "Migrating to Claude Opus 5.5", 2026-11-03 확인) 기준.
// 실제 청구와 다를 수 있어 첫 실제 호출 뒤 콘솔 사용량과 장부를 대조한다.

export interface Price {
  /** USD per 1M tokens */
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheRead: number;
}

export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite5m: 5, cacheRead: 0.2 },
  // 7단계 비교용 참고값 (ai_spec 2-8). 실행 전 다시 확인한다
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheRead: 0.01 },
};

export interface TokenUsage {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
}

export const ZERO_USAGE: TokenUsage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

export function priceOf(model: string): Price {
  const p = PRICES[model];
  if (!p) throw new Error(`가격표에 없는 모델: ${model} (pricing.ts에 추가 후 사용)`);
  return p;
}

export function costUsd(usage: TokenUsage, model: string): number {
  const p = priceOf(model);
  return (usage.input * p.input + usage.cacheWrite * p.cacheWrite5m + usage.cacheRead * p.cacheRead + usage.output * p.output) / 1_000_000;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return { input: a.input + b.input, cacheWrite: a.cacheWrite + b.cacheWrite, cacheRead: a.cacheRead + b.cacheRead, output: a.output + b.output };
}

/**
 * 글자 수로 입력 토큰을 보수적으로 어림한다 (한글·한자는 1글자 ≈ 1토큰, 그 밖은 3글자 ≈ 1토큰).
 * 실측 장부가 있으면 factor(실측 ÷ 어림 평균)로 보정한다.
 */
export function estimateTokens(text: string, factor = 1): number {
  let wide = 0;
  for (const ch of text) if (/[ㄱ-힝一-鿿]/.test(ch)) wide++;
  const other = [...text].length - wide;
  return Math.ceil((wide + other / 3) * factor);
}

/** 호출 1번의 최악 비용: 입력 전부를 캐시 쓰기 단가(더 비쌈)로, 출력은 max_tokens 전부 */
export function worstCallCost(inputTokens: number, maxTokens: number, model: string): number {
  const p = priceOf(model);
  return (inputTokens * Math.max(p.input, p.cacheWrite5m) + maxTokens * p.output) / 1_000_000;
}

export const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
