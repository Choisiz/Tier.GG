import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateLimiter } from '../../src/riot/rateLimiter.js';
import { FakeClock } from '../helpers/fakeClock.js';

const make = (clock: FakeClock, perSecond = 20, perWindow = 100) =>
  new RateLimiter({ perSecond, perWindow, windowMs: 120_000, clock });

describe('rateLimiter (가짜 시계)', () => {
  it('1초 안 20번째까지 바로, 21번째는 1초 창이 빌 때까지 대기', async () => {
    const c = new FakeClock();
    const l = make(c);
    for (let i = 0; i < 20; i++) await l.acquire();
    assert.equal(c.slept.length, 0);
    const t0 = c.now();
    await l.acquire();
    assert.equal(c.now() - t0, 1000);
  });

  it('120초 안 100번째 다음은 2분 창이 빌 때까지 대기', async () => {
    const c = new FakeClock();
    const l = make(c);
    const t0 = c.now();
    for (let i = 0; i < 100; i++) await l.acquire();
    // 20회마다 1초씩 기다렸으므로 100번째는 t0 + 4초
    assert.equal(c.now() - t0, 4000);
    await l.acquire();
    // 101번째는 첫 호출(t0)이 120초 창에서 빠지는 t0 + 120초
    assert.equal(c.now() - t0, 120_000);
    // t0에 찍은 20회가 함께 빠지고 101번째가 들어가 81회
    assert.equal(l.usage().perWindow, 81);
  });

  it('기본 설정 19/98을 지킨다', async () => {
    const c = new FakeClock();
    const l = make(c, 19, 98);
    for (let i = 0; i < 19; i++) await l.acquire();
    assert.equal(c.slept.length, 0);
    await l.acquire();
    assert.equal(c.slept.length, 1);
    // 어느 120초 구간에도 98회를 넘지 않는다
    const stamps: number[] = [];
    const c2 = new FakeClock();
    const l2 = make(c2, 19, 98);
    for (let i = 0; i < 300; i++) {
      await l2.acquire();
      stamps.push(c2.now());
    }
    for (let i = 0; i < stamps.length; i++) {
      const inWindow = stamps.filter((s) => s > (stamps[i] as number) - 120_000 && s <= (stamps[i] as number)).length;
      assert.ok(inWindow <= 98, `120초 창 ${inWindow}회`);
      const inSec = stamps.filter((s) => s > (stamps[i] as number) - 1000 && s <= (stamps[i] as number)).length;
      assert.ok(inSec <= 19, `1초 창 ${inSec}회`);
    }
  });

  it('429 후 block: Retry-After 동안 모든 호출을 멈춘다', async () => {
    const c = new FakeClock();
    const l = make(c);
    await l.acquire();
    l.block(7000);
    const t0 = c.now();
    await l.acquire();
    assert.equal(c.now() - t0, 7000);
  });

  it('응답 헤더 count가 우리 셈보다 크면 그만큼 채운다 (직전 실행 사용량 반영)', async () => {
    const c = new FakeClock();
    const l = make(c);
    await l.acquire();
    l.syncFromHeaders('1:1,99:120', '20:1,100:120');
    assert.equal(l.usage().perWindow, 99);
    await l.acquire(); // 100번째: 바로
    const t0 = c.now();
    await l.acquire(); // 101번째: 대기
    assert.ok(c.now() - t0 >= 119_000);
  });

  it('서버 한도가 설정보다 작으면 서버 한도를 따른다', () => {
    const c = new FakeClock();
    const l = make(c, 19, 98);
    l.syncFromHeaders(null, '10:1,50:120');
    assert.deepEqual(l.usage().limits, [10, 50]);
    l.syncFromHeaders(null, '100:1,1000:120'); // 더 큰 한도는 무시
    assert.deepEqual(l.usage().limits, [10, 50]);
  });

  it('동시에 불러도 순서대로 처리한다', async () => {
    const c = new FakeClock();
    const l = make(c);
    await Promise.all(Array.from({ length: 41 }, () => l.acquire()));
    assert.equal(c.now() - 1_000_000, 2000);
  });
});
