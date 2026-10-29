// 라인전 15분 골드 + 킬관여 (back_spec 변경 04, 04-10 완료 기준 1~7, 6b)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError } from '../../src/api/errors.js';
import { killParticipationPercent, matchListItem } from '../../src/api/dto.js';
import { createLaneGold, extractGold15, gold15Result, pairForLane, type LaneGoldRiot } from '../../src/api/laneGold.js';
import { createMatchLaneCache, laneInfoFromMatch, type MatchLaneCache } from '../../src/api/matchLaneCache.js';
import { silentLogger } from '../../src/lib/logger.js';
import { RiotKeyExpiredError, RiotNotFoundError, RiotRetryExhaustedError } from '../../src/riot/errors.js';
import type { MatchDto, TimelineDto } from '../../src/riot/types.js';
import { clone, loadMatch } from '../helpers/fixture.js';

// fixture: 1~5 = 100팀(TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY), 6~10 = 200팀(같은 순서), 게임 1295초
const P1 = 'TEST_PUUID_01';

function match(id = 'KR_1', edit?: (m: MatchDto) => void): MatchDto {
  const m = clone(loadMatch());
  m.metadata.matchId = id;
  edit?.(m);
  return m;
}

/** 프레임 n개짜리 가짜 timeline. gold: participantId → 15:00 totalGold (frames[15]에만 의미 있는 값) */
function timeline(frameCount: number, gold: Record<number, number | undefined>): TimelineDto {
  const frames = Array.from({ length: frameCount }, (_, i) => ({
    timestamp: i * 60_000,
    events: [],
    participantFrames: Object.fromEntries(
      Object.entries(gold).map(([id, g]) => [id, g === undefined ? {} : { totalGold: i === 15 ? g : 1 }]),
    ),
  }));
  return { metadata: { matchId: 'KR_1' }, info: { participants: [], frames } };
}
// 1번(TOP) 5396 vs 6번(TOP) 4939 → 52
const GOLD = { 1: 5396, 2: 4939, 3: 5000, 4: 5565, 5: 3958, 6: 4939, 7: 5747, 8: 5265, 9: 6699, 10: 4661 };

describe('killParticipationPercent (04-2b)', () => {
  // fixture 실제 게임에는 challenges.killParticipation이 있다(1번 0.2051…). 대체 계산 시험용으로는 challenges를 지운 복사본을 쓴다.
  const real = match();
  const stripped = (): MatchDto => {
    const m = match();
    for (const q of m.info.participants) delete q.challenges;
    return m;
  };

  it('fixture 실제 게임: challenges 값이 있고, 직접 계산 (7+1)/39와 같은 결과(21)', () => {
    const p = real.info.participants;
    assert.equal(typeof p[0]!.challenges?.killParticipation, 'number');
    assert.equal(killParticipationPercent(p[0]!, p), 21);
    const s = stripped().info.participants;
    assert.equal(killParticipationPercent(s[0]!, s), 21);
    // 10명 전원 challenges 값과 대체 계산이 같은 정수 %
    for (let i = 0; i < 10; i++) assert.equal(killParticipationPercent(p[i]!, p), killParticipationPercent(s[i]!, s), String(i));
  });

  it('challenges.killParticipation(0~1)을 그대로 반올림: 0.1667→17, 0.5833→58', () => {
    const p = stripped().info.participants;
    const me = p[0]!;
    me.challenges = { killParticipation: 0.1667 };
    assert.equal(killParticipationPercent(me, p), 17);
    me.challenges = { killParticipation: 0.5833 };
    assert.equal(killParticipationPercent(me, p), 58);
  });

  it('challenges 값이 대체 계산보다 우선한다 (0.9 → 90)', () => {
    const p = stripped().info.participants;
    p[0]!.challenges = { killParticipation: 0.9 };
    assert.equal(killParticipationPercent(p[0]!, p), 90);
  });

  it('100 초과 값도 자르지 않는다', () => {
    const p = stripped().info.participants;
    p[0]!.challenges = { killParticipation: 1.05 };
    assert.equal(killParticipationPercent(p[0]!, p), 105);
  });

  it('challenges는 있지만 숫자가 아니면 대체 계산', () => {
    const p = stripped().info.participants;
    p[0]!.challenges = {};
    assert.equal(killParticipationPercent(p[0]!, p), 21);
    p[0]!.challenges = { killParticipation: 'x' as unknown as number };
    assert.equal(killParticipationPercent(p[0]!, p), 21);
  });

  it('팀 킬 합이 0이면 null (0으로 나누지 않음)', () => {
    const m = stripped();
    for (const q of m.info.participants) q.kills = 0;
    assert.equal(killParticipationPercent(m.info.participants[0]!, m.info.participants), null);
  });

  it('matchListItem이 killParticipation을 싣는다', () => {
    assert.equal(matchListItem(real, P1).killParticipation, 21);
    const m = stripped();
    m.info.participants[0]!.challenges = { killParticipation: 0.4615 };
    assert.equal(matchListItem(m, P1).killParticipation, 46);
  });
});

describe('pairForLane / extractGold15 / gold15Result (04-2)', () => {
  const info = laneInfoFromMatch(match());

  it('상대 = 적 팀의 같은 포지션. 정글·서폿도 같은 규칙', () => {
    assert.equal(pairForLane(info.players, 'TEST_PUUID_01')?.enemy.participantId, 6);
    assert.equal(pairForLane(info.players, 'TEST_PUUID_02')?.enemy.participantId, 7);
    assert.equal(pairForLane(info.players, 'TEST_PUUID_05')?.enemy.participantId, 10);
    assert.equal(pairForLane(info.players, 'TEST_PUUID_10')?.enemy.participantId, 5);
  });

  it('포지션 Invalid·빈 값·없음 → null', () => {
    for (const pos of ['Invalid', '', undefined]) {
      const m = match('KR_1', (x) => {
        x.info.participants[0]!.individualPosition = pos;
      });
      assert.equal(pairForLane(laneInfoFromMatch(m).players, P1), null, String(pos));
    }
  });

  it('적 팀에 같은 포지션이 0명 또는 2명 → null', () => {
    const none = match('KR_1', (x) => {
      x.info.participants[5]!.individualPosition = 'MIDDLE'; // 6번이 TOP이 아니게 → 상대 TOP 0명
    });
    assert.equal(pairForLane(laneInfoFromMatch(none).players, P1), null);
    const two = match('KR_1', (x) => {
      x.info.participants[6]!.individualPosition = 'TOP'; // 7번도 TOP → 2명
    });
    assert.equal(pairForLane(laneInfoFromMatch(two).players, P1), null);
  });

  it('puuid가 참가자가 아니면 null', () => {
    assert.equal(pairForLane(info.players, 'NOBODY'), null);
  });

  it('extractGold15: 프레임 16개 이상이면 frames[15]의 totalGold, 15개 이하면 null', () => {
    assert.deepEqual(extractGold15(timeline(25, GOLD)), GOLD);
    assert.deepEqual(extractGold15(timeline(16, GOLD)), GOLD);
    assert.equal(extractGold15(timeline(15, GOLD)), null);
    assert.equal(extractGold15(timeline(0, GOLD)), null);
  });

  it('extractGold15: totalGold가 없는 참가자는 키가 없다', () => {
    const g = extractGold15(timeline(20, { 1: 100, 6: undefined }));
    assert.deepEqual(g, { 1: 100 });
  });

  it('gold15Result: 5396 : 4939 → 52, 골드 값도 함께', () => {
    const r = gold15Result({ ...info, gold15: GOLD }, 'TEST_PUUID_01');
    assert.deepEqual(r, { myPercent: 52, myGold: 5396, enemyGold: 4939 });
    // 상대 시점은 48
    assert.equal(gold15Result({ ...info, gold15: GOLD }, 'TEST_PUUID_06')?.myPercent, 48);
  });

  it('gold15Result: 반올림 경계(0.5는 올림)와 정글 매칭', () => {
    assert.equal(gold15Result({ ...info, gold15: { 1: 1, 6: 1 } }, 'TEST_PUUID_01')?.myPercent, 50);
    assert.equal(gold15Result({ ...info, gold15: { 2: 2, 7: 1 } }, 'TEST_PUUID_02')?.myPercent, 67);
  });

  it('gold15Result: gold15 없음/null, 내 totalGold 없음, 둘 다 0 → null', () => {
    assert.equal(gold15Result({ ...info }, P1), null);
    assert.equal(gold15Result({ ...info, gold15: null }, P1), null);
    assert.equal(gold15Result({ ...info, gold15: { 6: 100 } }, P1), null);
    assert.equal(gold15Result({ ...info, gold15: { 1: 0, 6: 0 } }, P1), null);
  });
});

// ───────── 서비스 ─────────

interface Fake {
  riot: LaneGoldRiot;
  calls: { match: string[]; timeline: string[] };
  waits: { value: number };
  cache: MatchLaneCache;
  svc: ReturnType<typeof createLaneGold>;
  t: { now: number };
}

function setup(opts: {
  matches?: Record<string, MatchDto>;
  timelines?: Record<string, TimelineDto | Error>;
  matchErr?: Error;
  cacheMax?: number;
} = {}): Fake {
  const calls = { match: [] as string[], timeline: [] as string[] };
  const waits = { value: 0 };
  const t = { now: 1_000_000 };
  const riot: LaneGoldRiot = {
    limiterWaitMs: () => waits.value,
    async getMatch(id: string) {
      calls.match.push(id);
      if (opts.matchErr) throw opts.matchErr;
      const m = opts.matches?.[id] ?? match(id);
      return m;
    },
    async getTimeline(id: string) {
      calls.timeline.push(id);
      await Promise.resolve(); // 동시 호출 시험을 위해 비동기 경계를 둔다
      const tl = opts.timelines?.[id] ?? timeline(25, GOLD);
      if (tl instanceof Error) throw tl;
      return tl;
    },
  } as LaneGoldRiot;
  const cache = createMatchLaneCache(6 * 3600_000, opts.cacheMax ?? 5000);
  const svc = createLaneGold({ riot, cache, logger: silentLogger, now: () => t.now });
  return { riot, calls, waits, cache, svc, t };
}

describe('laneGold 서비스 (04-7)', () => {
  it('정상: 경기 정보가 없으면 getMatch 1 + timeline 1, 응답 순서·개수 유지', async () => {
    const f = setup();
    const r = await f.svc(P1, ['KR_1', 'KR_2']);
    assert.deepEqual(r.results.map((x) => x.matchId), ['KR_1', 'KR_2']);
    assert.deepEqual(r.results[0], { matchId: 'KR_1', state: 'ready', myPercent: 52, myGold: 5396, enemyGold: 4939 });
    assert.equal(r.retryAfterSec, null);
    assert.equal(f.calls.match.length, 2);
    assert.equal(f.calls.timeline.length, 2);
  });

  it('재요청: 같은 matchId는 Riot 호출 0회 (캐시 적중)', async () => {
    const f = setup();
    await f.svc(P1, ['KR_1']);
    const before = { m: f.calls.match.length, t: f.calls.timeline.length };
    const r = await f.svc(P1, ['KR_1']);
    assert.equal(r.results[0]!.state, 'ready');
    assert.deepEqual({ m: f.calls.match.length, t: f.calls.timeline.length }, before);
  });

  it('검색이 넣어 둔 경기 정보가 있으면 getMatch 없이 timeline만 1회', async () => {
    const f = setup();
    f.cache.set('KR_1', laneInfoFromMatch(match()), f.t.now);
    await f.svc(P1, ['KR_1']);
    assert.equal(f.calls.match.length, 0);
    assert.equal(f.calls.timeline.length, 1);
  });

  it('동시에 두 요청이 같은 matchId를 가져가도 Riot은 1번만 (진행 중 Promise 공유)', async () => {
    const f = setup();
    const [a, b] = await Promise.all([f.svc(P1, ['KR_1']), f.svc('TEST_PUUID_02', ['KR_1'])]);
    assert.equal(a.results[0]!.state, 'ready');
    assert.equal(b.results[0]!.state, 'ready');
    assert.equal(f.calls.match.length, 1);
    assert.equal(f.calls.timeline.length, 1);
  });

  it('TTL 6시간이 지나면 다시 Riot을 부른다', async () => {
    const f = setup();
    await f.svc(P1, ['KR_1']);
    f.t.now += 6 * 3600_000;
    await f.svc(P1, ['KR_1']);
    assert.equal(f.calls.match.length, 2);
    assert.equal(f.calls.timeline.length, 2);
  });

  it('호출 생략: 15분 미만(gameDuration < 900)은 timeline 0회 → unavailable', async () => {
    const short = match('KR_1', (m) => {
      m.info.gameDuration = 899;
    });
    const f = setup({ matches: { KR_1: short } });
    const r = await f.svc(P1, ['KR_1']);
    assert.equal(r.results[0]!.state, 'unavailable');
    assert.equal(f.calls.timeline.length, 0);
    // 900초는 호출한다
    const ok = match('KR_2', (m) => {
      m.info.gameDuration = 900;
    });
    const f2 = setup({ matches: { KR_2: ok } });
    await f2.svc(P1, ['KR_2']);
    assert.equal(f2.calls.timeline.length, 1);
  });

  it('호출 생략: 포지션 Invalid·상대 없음·puuid가 참가자가 아님은 timeline 0회 → unavailable (gold15는 캐시하지 않음)', async () => {
    const noPos = match('KR_1', (m) => {
      m.info.participants[0]!.individualPosition = 'Invalid';
    });
    const f = setup({ matches: { KR_1: noPos } });
    assert.equal((await f.svc(P1, ['KR_1'])).results[0]!.state, 'unavailable');
    assert.equal((await f.svc('NOBODY', ['KR_1'])).results[0]!.state, 'unavailable');
    assert.equal(f.calls.timeline.length, 0);
    assert.equal(f.cache.get('KR_1', f.t.now)!.gold15, undefined);
    // 같은 경기라도 다른 참가자(2번)는 대상이면 timeline을 부른다
    assert.equal((await f.svc('TEST_PUUID_02', ['KR_1'])).results[0]!.state, 'ready');
    assert.equal(f.calls.timeline.length, 1);
  });

  it('프레임 부족(≤15)은 unavailable이고 gold15=null로 기억해 다시 부르지 않는다', async () => {
    const f = setup({ timelines: { KR_1: timeline(15, GOLD) } });
    assert.equal((await f.svc(P1, ['KR_1'])).results[0]!.state, 'unavailable');
    assert.equal((await f.svc(P1, ['KR_1'])).results[0]!.state, 'unavailable');
    assert.equal(f.calls.timeline.length, 1);
    assert.equal(f.cache.get('KR_1', f.t.now)!.gold15, null);
  });

  it('timeline 404 → unavailable, gold15=null로 기억 (재호출 안 함)', async () => {
    const f = setup({ timelines: { KR_1: new RiotNotFoundError('없음', 404, 'p') } });
    assert.equal((await f.svc(P1, ['KR_1'])).results[0]!.state, 'unavailable');
    await f.svc(P1, ['KR_1']);
    assert.equal(f.calls.timeline.length, 1);
  });

  it('getMatch 404(모르는 경기) → unavailable, 다시 부르지 않음', async () => {
    const f = setup({ matchErr: new RiotNotFoundError('없음', 404, 'p') });
    assert.equal((await f.svc(P1, ['KR_9'])).results[0]!.state, 'unavailable');
    await f.svc(P1, ['KR_9']);
    assert.equal(f.calls.match.length, 1);
    assert.equal(f.calls.timeline.length, 0);
  });

  it('내 participantFrames/totalGold가 없으면 unavailable', async () => {
    const f = setup({ timelines: { KR_1: timeline(25, { ...GOLD, 1: undefined }) } });
    assert.equal((await f.svc(P1, ['KR_1'])).results[0]!.state, 'unavailable');
  });

  it('캐시에 timeline 원본(frames)을 저장하지 않는다, gold15 숫자만', async () => {
    const f = setup();
    await f.svc(P1, ['KR_1']);
    const entry = f.cache.get('KR_1', f.t.now)!;
    assert.equal(JSON.stringify(entry).includes('frames'), false);
    assert.deepEqual(entry.gold15, GOLD);
  });

  it('한도: 제한기 대기 > 1.5초면 그 호출부터 pending, retryAfterSec = 올림 초, 캐시로 되는 것은 그대로 ready', async () => {
    const f = setup();
    await f.svc(P1, ['KR_1']); // KR_1은 캐시에 완성
    f.waits.value = 3200;
    const r = await f.svc(P1, ['KR_1', 'KR_2', 'KR_3']);
    assert.deepEqual(r.results.map((x) => x.state), ['ready', 'pending', 'pending']);
    assert.equal(r.retryAfterSec, 4);
    // pending이면 Riot을 새로 부르지 않았다
    assert.equal(f.calls.match.length, 1);
  });

  it('한도: 정확히 1.5초 대기는 허용(pending 아님), retryAfterSec 상한 120', async () => {
    const f = setup();
    f.waits.value = 1500;
    assert.equal((await f.svc(P1, ['KR_1'])).results[0]!.state, 'ready');
    const g = setup();
    g.waits.value = 500_000;
    const r = await g.svc(P1, ['KR_1']);
    assert.equal(r.results[0]!.state, 'pending');
    assert.equal(r.retryAfterSec, 120);
  });

  it('한도: 1ms 대기여도 pending이 없으면 retryAfterSec는 null', async () => {
    const f = setup();
    f.waits.value = 1;
    assert.equal((await f.svc(P1, ['KR_1'])).retryAfterSec, null);
  });

  it('401/403 → 503 RIOT_KEY_EXPIRED', async () => {
    const f = setup({ matchErr: new RiotKeyExpiredError('만료', 401, 'p') });
    await assert.rejects(f.svc(P1, ['KR_1']), (e: ApiError) => e.status === 503 && e.code === 'RIOT_KEY_EXPIRED');
  });

  it('timeline 429/5xx 소진 → 502 RIOT_UNAVAILABLE (이미 받은 경기 정보는 캐시에 남음)', async () => {
    const f = setup({ timelines: { KR_1: new RiotRetryExhaustedError('소진', 503, 'p') } });
    await assert.rejects(f.svc(P1, ['KR_1']), (e: ApiError) => e.status === 502 && e.code === 'RIOT_UNAVAILABLE');
    assert.ok(f.cache.get('KR_1', f.t.now));
  });

  it('예상 못한 오류는 그대로 던진다 (500 처리)', async () => {
    const f = setup({ matchErr: new Error('boom') });
    await assert.rejects(f.svc(P1, ['KR_1']), /boom/);
  });
});
