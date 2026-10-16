// 가짜 시계: sleep(ms)이 바로 시간을 앞으로 돌린다
import type { Clock } from '../../src/riot/rateLimiter.js';

export class FakeClock implements Clock {
  t = 1_000_000;
  slept: number[] = [];
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    this.slept.push(ms);
    this.t += ms;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
