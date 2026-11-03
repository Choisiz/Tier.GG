// 유료 호출 장부 (ai_spec 2-8): 한 줄 = 호출 1번 (JSONL). 키·puuid는 넣지 않는다.
// 누적 비용으로 예산 상한(FEEDBACK_BUDGET_USD)을 지킨다.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TokenUsage } from './pricing.js';

export interface LedgerEntry {
  at: string;
  matchId: string;
  participantId: number;
  model: string;
  effort: string;
  promptVersion: string;
  /** 1 = 첫 호출, 2 = 검증 실패 재시도 또는 파싱 실패 다시 하기 */
  attempt: number;
  kind: 'first' | 'retry' | 'first_again';
  /** 예산 검사에 쓴 입력 토큰 어림 (보정 계수를 곱한 값) */
  estInputTokens: number;
  /** estInputTokens에 곱한 보정 계수. 2026-11-03 Build 장부(8줄)에는 없다 → calibration이 당시 계수를 다시 계산한다 */
  inputFactor?: number;
  usage: TokenUsage;
  stopReason: string | null;
  costUsd: number;
  durationMs: number;
  recording: string | null;
  error: string | null;
}

export interface Ledger {
  entries(): LedgerEntry[];
  append(e: LedgerEntry): void;
  totalUsd(): number;
}

export function totalOf(entries: readonly LedgerEntry[]): number {
  return entries.reduce((s, e) => s + e.costUsd, 0);
}

/** 파일 장부 */
export function fileLedger(path: string): Ledger {
  const read = (): LedgerEntry[] => {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as LedgerEntry);
  };
  return {
    entries: read,
    append(e) {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(e)}\n`);
    },
    totalUsd: () => totalOf(read()),
  };
}

/** 메모리 장부 (테스트용) */
export function memoryLedger(initial: LedgerEntry[] = []): Ledger {
  const list = [...initial];
  return { entries: () => [...list], append: (e) => void list.push(e), totalUsd: () => totalOf(list) };
}

/**
 * 같은 모델·프롬프트 버전의 첫 호출 실측으로 입력 어림 보정 계수와 평균 출력 토큰을 구한다.
 * 계수 = 실측 입력 합 ÷ **보정 전** 어림 합. 장부의 estInputTokens는 그때 계수를 곱한 값이라 계수로 나눠 되돌린다
 * (Review 2026-11-03: 곱한 값을 그대로 더하면 계수가 이중 보정돼 1.63 → 1.28로 내려가 예산 검사가 느슨해졌다).
 * inputFactor가 없는 옛 줄은 당시 코드와 같은 계산(앞 줄들의 실측 합 ÷ 장부 어림 합)으로 곱했던 계수를 다시 구한다.
 */
export function calibration(entries: readonly LedgerEntry[], model: string, promptVersion: string): { inputFactor: number; avgOutput: number | null; samples: number } {
  let actual = 0;
  let stored = 0;
  let raw = 0;
  let output = 0;
  let n = 0;
  for (const e of entries) {
    if (e.model !== model || e.promptVersion !== promptVersion || e.kind !== 'first' || e.estInputTokens <= 0 || e.error) continue;
    const applied = e.inputFactor ?? (stored > 0 ? actual / stored : 1);
    actual += e.usage.input + e.usage.cacheWrite + e.usage.cacheRead;
    stored += e.estInputTokens;
    raw += e.estInputTokens / applied;
    output += e.usage.output;
    n++;
  }
  if (n === 0) return { inputFactor: 1, avgOutput: null, samples: 0 };
  return { inputFactor: actual / raw, avgOutput: output / n, samples: n };
}

export class BudgetExceededError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly worstUsd: number,
    readonly budgetUsd: number,
  ) {
    super(`예산 초과: 누적 $${spentUsd.toFixed(4)} + 이번 최악 $${worstUsd.toFixed(4)} > $${budgetUsd.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

/** 누적 + 이번 호출 최악 비용이 상한을 넘으면 던진다 */
export function assertBudget(ledger: Ledger, worstUsd: number, budgetUsd: number): void {
  const spent = ledger.totalUsd();
  if (spent + worstUsd > budgetUsd + 1e-12) throw new BudgetExceededError(spent, worstUsd, budgetUsd);
}
