// 이중 창 제한기 (back_spec 3-6)
// - 1초 창, 120초 창 두 개를 동시에 지킨다 (기본 19회 / 98회: 계약 20 / 100에서 여유분)
// - 모든 Riot 호출이 이 제한기 하나를 공유한다
// - 응답 헤더 X-App-Rate-Limit-Count가 우리 셈보다 크면(직전 실행, 다른 프로세스) 그만큼 채워 넣는다
// - 429 Retry-After를 받으면 그 시간 동안 모든 호출을 멈춘다
// - now()/sleep()을 주입할 수 있어 단위 테스트에서 가짜 시계를 쓴다

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

interface Window {
  limit: number;
  ms: number;
  stamps: number[];
}

export interface RateLimiterOptions {
  perSecond: number;
  perWindow: number;
  windowMs: number;
  clock?: Clock;
}

export class RateLimiter {
  private readonly windows: Window[];
  private readonly clock: Clock;
  private blockedUntil = 0;
  private chain: Promise<void> = Promise.resolve();
  /** 대기한 총 시간 (ms, 로그용) */
  waitedMs = 0;

  constructor(opts: RateLimiterOptions) {
    this.clock = opts.clock ?? realClock;
    this.windows = [
      { limit: opts.perSecond, ms: 1000, stamps: [] },
      { limit: opts.perWindow, ms: opts.windowMs, stamps: [] },
    ];
  }

  /** 호출 1회를 쓸 수 있을 때까지 기다린다. 동시에 불러도 순서대로 처리한다. */
  acquire(): Promise<void> {
    const next = this.chain.then(() => this.acquireInner());
    this.chain = next.catch(() => {});
    return next;
  }

  private async acquireInner(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      const wait = this.waitTime(now);
      if (wait <= 0) {
        for (const w of this.windows) w.stamps.push(now);
        return;
      }
      this.waitedMs += wait;
      await this.clock.sleep(wait);
    }
  }

  private prune(now: number): void {
    for (const w of this.windows) {
      while (w.stamps.length > 0 && (w.stamps[0] as number) <= now - w.ms) w.stamps.shift();
    }
  }

  /** 지금 호출하려면 몇 ms 기다려야 하는지 (0이면 바로) */
  waitTime(now: number): number {
    this.prune(now);
    let wait = this.blockedUntil - now;
    for (const w of this.windows) {
      if (w.stamps.length >= w.limit) {
        // 창 안의 호출이 한도만큼 있으면, 가장 오래된 (개수 - 한도 + 1)번째가 빠질 때까지
        const idx = w.stamps.length - w.limit;
        const oldest = w.stamps[idx] as number;
        wait = Math.max(wait, oldest + w.ms - now);
      }
    }
    return wait;
  }

  /** 429 Retry-After: 그 시간 동안 모든 호출을 멈춘다 */
  block(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.clock.now() + ms);
  }

  /**
   * 응답 헤더로 셈을 맞춘다.
   * countHeader 예: "12:1,57:120" (호출 수:창 초). 서버 수가 우리 셈보다 크면 차이만큼 지금 시각으로 채운다.
   * limitHeader 예: "20:1,100:120". 서버 한도가 설정보다 작으면 서버 한도를 따른다.
   */
  syncFromHeaders(countHeader: string | null, limitHeader: string | null): void {
    const now = this.clock.now();
    this.prune(now);
    for (const [value, seconds] of parsePairs(limitHeader)) {
      const w = this.windows.find((x) => x.ms === seconds * 1000);
      if (w && value > 0 && value < w.limit) w.limit = value;
    }
    for (const [count, seconds] of parsePairs(countHeader)) {
      const w = this.windows.find((x) => x.ms === seconds * 1000);
      if (!w) continue;
      const missing = count - w.stamps.length;
      for (let i = 0; i < missing; i++) w.stamps.push(now);
      w.stamps.sort((a, b) => a - b);
    }
  }

  /** 현재 창별 사용량 (로그용) */
  usage(): { perSecond: number; perWindow: number; limits: [number, number] } {
    const now = this.clock.now();
    this.prune(now);
    const [s, l] = this.windows as [Window, Window];
    return { perSecond: s.stamps.length, perWindow: l.stamps.length, limits: [s.limit, l.limit] };
  }
}

function parsePairs(header: string | null): [number, number][] {
  if (!header) return [];
  const out: [number, number][] = [];
  for (const part of header.split(',')) {
    const m = /^\s*(\d+):(\d+)\s*$/.exec(part);
    if (m) out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}
