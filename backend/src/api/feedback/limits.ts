// 비용 보호 장치 (back_spec 변경 05, 05-8): 하루 상한, 누적 예산, 동시 실행, 차단기.
// 동시 요청에서도 상한을 넘지 않게 "먼저 예약하고, 끝나면 정산"한다.
import type { LedgerEntry } from '../../analysis/llm/ledger.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** KST 날짜 키 YYYY-MM-DD */
export function kstDateKey(ms: number): string {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 다음 KST 자정(UTC 15:00)의 ms */
export function nextKstMidnight(ms: number): number {
  return (Math.floor((ms + KST_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - KST_OFFSET_MS;
}

/** 장부에서 오늘(KST) 실제 비용이 든 분석 수: kind="first"이고 costUsd>0인 줄 (05-8 ① 재시작 복원) */
export function countTodayFromLedger(entries: readonly LedgerEntry[], nowMs: number): number {
  const today = kstDateKey(nowMs);
  let n = 0;
  for (const e of entries) {
    if (e.kind !== 'first' || !(e.costUsd > 0)) continue;
    const t = Date.parse(e.at);
    if (Number.isFinite(t) && kstDateKey(t) === today) n++;
  }
  return n;
}

// ───────── ① 하루 상한 ─────────

export interface DailyLimit {
  readonly limit: number;
  /** 자리 1개 예약. 꽉 찼으면 false */
  tryReserve(nowMs: number): boolean;
  /** 예약 정산: 실제 비용이 있었으면 사용 수로, 없으면 반납 */
  settle(used: boolean, nowMs: number): void;
  used(nowMs: number): number;
  resetAt(nowMs: number): number;
}

export function createDailyLimit(limit: number, restoredToday: number, startMs: number): DailyLimit {
  let day = kstDateKey(startMs);
  let used = restoredToday;
  let reserved = 0;
  const roll = (nowMs: number) => {
    const k = kstDateKey(nowMs);
    if (k !== day) {
      day = k;
      used = 0;
      // 자정을 넘긴 진행 중 예약은 그대로 둔다(끝나면 settle로 정리). 새 날의 사용 수만 0
    }
  };
  return {
    limit,
    tryReserve(nowMs) {
      roll(nowMs);
      if (used + reserved >= limit) return false;
      reserved++;
      return true;
    },
    settle(wasUsed, nowMs) {
      roll(nowMs);
      reserved = Math.max(0, reserved - 1);
      if (wasUsed) used++;
    },
    used(nowMs) {
      roll(nowMs);
      return used;
    },
    resetAt: nextKstMidnight,
  };
}

// ───────── ② 누적 예산 ─────────

export interface BudgetGuard {
  readonly budgetUsd: number;
  /** 장부 합 + 진행 중 예약 + 이번 최악 ≤ 상한이면 예약 id, 아니면 null */
  tryReserve(worstUsd: number): number | null;
  release(id: number): void;
  spentUsd(): number;
  reservedUsd(): number;
}

export function createBudgetGuard(budgetUsd: number, spent: () => number): BudgetGuard {
  const holds = new Map<number, number>();
  let seq = 0;
  const reservedUsd = () => [...holds.values()].reduce((s, x) => s + x, 0);
  return {
    budgetUsd,
    tryReserve(worstUsd) {
      if (spent() + reservedUsd() + worstUsd > budgetUsd + 1e-12) return null;
      const id = ++seq;
      holds.set(id, worstUsd);
      return id;
    },
    release(id) {
      holds.delete(id);
    },
    spentUsd: spent,
    reservedUsd,
  };
}

// ───────── ③ 동시 실행 ─────────

export interface Semaphore {
  /** 자리를 얻으면 release 함수. 대기열도 꽉 찼으면 null (바로 503) */
  acquire(): Promise<(() => void) | null>;
  readonly active: number;
  readonly waiting: number;
}

export function createSemaphore(concurrency: number, queueMax: number): Semaphore {
  let active = 0;
  const queue: (() => void)[] = [];
  const makeRelease = () => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = queue.shift();
      if (next) next(); // 자리를 그대로 넘긴다 (active 유지)
      else active--;
    };
  };
  return {
    async acquire() {
      if (active < concurrency) {
        active++;
        return makeRelease();
      }
      if (queue.length >= queueMax) return null;
      await new Promise<void>((resolve) => queue.push(resolve));
      return makeRelease();
    },
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
  };
}

// ───────── 차단기 ─────────

export interface Breaker {
  isOpen(nowMs: number): boolean;
  /** 열기. 이미 열려 있었으면 false (오류 로그를 1번만 남기려고) */
  open(nowMs: number): boolean;
}

export function createBreaker(durationMs: number): Breaker {
  let until = 0;
  return {
    isOpen: (nowMs) => nowMs < until,
    open(nowMs) {
      const wasOpen = nowMs < until;
      until = nowMs + durationMs;
      return !wasOpen;
    },
  };
}
