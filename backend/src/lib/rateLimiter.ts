const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * In-process rate limiter for Riot API
 * - Max 9 requests per 1 second
 * - Max 100 requests per 120 seconds
 */
class RiotRateLimiter {
  private readonly maxPerSecond = 9;
  private readonly maxPerWindow = 100;
  private readonly windowMs = 120_000; // 120s

  private readonly timestamps: number[] = [];
  private lock: Promise<void> | null = null;
  private release: (() => void) | null = null;

  private async acquireLock(): Promise<void> {
    while (this.lock) {
      await this.lock;
    }
    this.lock = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  private releaseLock(): void {
    const rel = this.release;
    this.lock = null;
    this.release = null;
    if (rel) rel();
  }

  private prune(now: number): void {
    // Drop entries older than window (keep list reasonably small)
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  private countSince(now: number, durationMs: number): number {
    const cutoff = now - durationMs;
    let i = this.timestamps.length - 1;
    let count = 0;
    while (i >= 0 && this.timestamps[i] >= cutoff) {
      count++;
      i--;
    }
    return count;
  }

  private nextAllowedDelayMs(now: number): number {
    // If per-second limit exceeded: wait until the oldest within 1s falls out
    const oneSecond = 1000;
    const cutoff1s = now - oneSecond;
    let count1s = 0;
    let oldestWithin1s = Infinity;
    for (let i = this.timestamps.length - 1; i >= 0; i--) {
      const t = this.timestamps[i];
      if (t < cutoff1s) break;
      count1s++;
      if (t < oldestWithin1s) oldestWithin1s = t;
    }

    let delay1s = 0;
    if (count1s >= this.maxPerSecond && oldestWithin1s !== Infinity) {
      delay1s = oldestWithin1s + oneSecond - now + 1;
    }

    // If 2-min window limit exceeded: wait until the oldest within 120s falls out
    const cutoffWin = now - this.windowMs;
    let countWin = 0;
    let oldestWithinWin = Infinity;
    for (let i = this.timestamps.length - 1; i >= 0; i--) {
      const t = this.timestamps[i];
      if (t < cutoffWin) break;
      countWin++;
      if (t < oldestWithinWin) oldestWithinWin = t;
    }

    let delayWin = 0;
    if (countWin >= this.maxPerWindow && oldestWithinWin !== Infinity) {
      delayWin = oldestWithinWin + this.windowMs - now + 1;
    }

    return Math.max(delay1s, delayWin, 0);
  }

  /** Acquire a permit respecting both limits. */
  async wait(): Promise<void> {
    while (true) {
      const now = Date.now();
      await this.acquireLock();
      try {
        this.prune(now);
        const delay = this.nextAllowedDelayMs(now);
        if (delay <= 0) {
          this.timestamps.push(now);
          return;
        }
        // Release lock while sleeping to not block others from computing delay
        this.releaseLock();
        await sleep(delay);
        continue;
      } finally {
        if (this.lock) {
          // Only release if not already released above
          this.releaseLock();
        }
      }
    }
  }
}

export const riotRateLimiter = new RiotRateLimiter();
