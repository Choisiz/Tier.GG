// window 객체: displayName, share, isStale 경계, health 상태, 경고 1시간 1번 (변경 01-6-2, 01-6-3)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createStaleWarner,
  displayPatch,
  isStale,
  requireWindow,
  sharePercent,
  statsState,
  windowDto,
} from '../../src/api/window.js';
import { ApiError } from '../../src/api/errors.js';
import type { Logger } from '../../src/lib/logger.js';
import { silentLogger } from '../../src/lib/logger.js';

const H = 3_600_000;

function recordingLogger(): Logger & { warns: string[] } {
  const warns: string[] = [];
  return { ...silentLogger, warn: (msg: string) => void warns.push(msg), warns };
}

describe('window', () => {
  it('displayPatch = 메이저 + 10', () => {
    assert.equal(displayPatch('16.20'), '26.20');
    assert.equal(displayPatch('16.9'), '26.9');
    assert.equal(displayPatch('15.24'), '25.24');
    assert.equal(displayPatch('0.9'), '10.9');
  });

  it('형식이 아니면 내부 값 그대로 + 경고', () => {
    const l = recordingLogger();
    assert.equal(displayPatch('16.20.1', l), '16.20.1');
    assert.equal(l.warns.length, 1);
  });

  it('share 소수 2자리: 992/2481 → 39.98, 1489/2481 → 60.02', () => {
    assert.equal(sharePercent(992, 2481), 39.98);
    assert.equal(sharePercent(1489, 2481), 60.02);
    assert.equal(sharePercent(36, 60), 60);
    assert.equal(sharePercent(1, 0), 0);
  });

  it('isStale: 정확히 26시간 false, +1ms true', () => {
    const at = new Date('2026-10-14T20:00:00.000Z');
    assert.equal(isStale(at, at.getTime() + 26 * H), false);
    assert.equal(isStale(at, at.getTime() + 26 * H + 1), true);
    assert.equal(statsState(at, at.getTime() + 26 * H), 'fresh');
    assert.equal(statsState(at, at.getTime() + 26 * H + 1), 'stale');
    assert.equal(statsState(null, 0), 'empty');
  });

  it('windowDto 형식 (계약 2-0 예시)', () => {
    const at = new Date('2026-10-15T20:00:00.418Z');
    const dto = windowDto(
      {
        days: 14,
        windowStart: new Date('2026-10-01T20:00:00.418Z'),
        windowEnd: at,
        games: 2481,
        aggregatedAt: at,
        patches: [
          { patch: '16.20', games: 1489 },
          { patch: '16.19', games: 992 },
        ],
      },
      at.getTime() + H,
    );
    assert.deepEqual(dto, {
      days: 14,
      start: '2026-10-01T20:00:00.418Z',
      end: '2026-10-15T20:00:00.418Z',
      games: 2481,
      aggregatedAt: '2026-10-15T20:00:00.418Z',
      isStale: false,
      patches: [
        { patch: '16.20', displayName: '26.20', games: 1489, share: 60.02 },
        { patch: '16.19', displayName: '26.19', games: 992, share: 39.98 },
      ],
    });
  });

  it('requireWindow(null) → 503 STATS_NOT_READY', () => {
    assert.throws(
      () => requireWindow(null),
      (e: unknown) => e instanceof ApiError && e.status === 503 && e.code === 'STATS_NOT_READY',
    );
  });

  it('오래됨 경고는 1시간에 1번', () => {
    const l = recordingLogger();
    const warn = createStaleWarner(l);
    const at = new Date(0);
    warn(at, 10 * H); // 신선 → 경고 없음
    assert.equal(l.warns.length, 0);
    warn(at, 27 * H);
    warn(at, 27 * H + 59 * 60_000);
    assert.equal(l.warns.length, 1);
    warn(at, 28 * H);
    assert.equal(l.warns.length, 2);
  });
});
