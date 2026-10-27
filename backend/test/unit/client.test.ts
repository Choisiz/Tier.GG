import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RiotClient, type FetchLike } from '../../src/riot/client.js';
import {
  RiotBadRequestError,
  RiotKeyExpiredError,
  RiotNotFoundError,
  RiotRetryExhaustedError,
} from '../../src/riot/errors.js';
import { RateLimiter } from '../../src/riot/rateLimiter.js';
import { silentLogger } from '../../src/lib/logger.js';
import { FakeClock } from '../helpers/fakeClock.js';

const KEY = 'RGAPI-00000000-0000-0000-0000-000000000000';

function setup(responses: (() => Response | Promise<Response>)[]) {
  const clock = new FakeClock();
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('응답이 더 없음');
    return next();
  };
  const limiter = new RateLimiter({ perSecond: 19, perWindow: 98, windowMs: 120_000, clock });
  const client = new RiotClient({
    apiKey: KEY,
    platformUrl: 'https://kr.example',
    regionUrl: 'https://asia.example',
    limiter,
    config: { requestTimeoutMs: 10_000, retry5xx: 3, retry429: 5, default429WaitSec: 10, rateLogIntervalMs: 600_000 },
    logger: silentLogger,
    fetch,
    clock,
  });
  return { client, calls, clock };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('riot client (가짜 fetch)', () => {
  it('키는 X-Riot-Token 헤더에만, URL에는 없음', async () => {
    const { client, calls } = setup([json(200, ['KR_1'])]);
    assert.deepEqual(
      await client.getMatchIds('PUUID_X', { queue: 420, start: 0, count: 20, startTime: 1790816400 }),
      ['KR_1'],
    );
    assert.equal(calls.length, 1);
    const c = calls[0]!;
    assert.equal(
      c.url,
      'https://asia.example/lol/match/v5/matches/by-puuid/PUUID_X/ids?queue=420&start=0&count=20&startTime=1790816400',
    );
    assert.ok(!c.url.includes(KEY));
    assert.equal((c.init.headers as Record<string, string>)['X-Riot-Token'], KEY);
  });

  it('startTime에 ms(13자리)·소수·9자리를 넣으면 호출 전에 던짐', async () => {
    const { client, calls } = setup([]);
    for (const bad of [1790816400000, 1790816400.5, 179081640]) {
      await assert.rejects(client.getMatchIds('PUUID_X', { queue: 420, start: 0, count: 20, startTime: bad }), TypeError);
    }
    assert.equal(calls.length, 0);
  });

  for (const status of [401, 403]) {
    it(`${status} → RiotKeyExpiredError, 재시도 없음`, async () => {
      const { client, calls } = setup([json(status, {}), json(200, {})]);
      await assert.rejects(client.getMatch('KR_1'), RiotKeyExpiredError);
      assert.equal(calls.length, 1);
    });
  }

  it('429 → Retry-After초 기다린 뒤 재시도', async () => {
    const { client, calls, clock } = setup([json(429, {}, { 'retry-after': '3' }), json(200, { ok: 1 })]);
    const t0 = clock.now();
    assert.deepEqual(await client.getMatch('KR_1'), { ok: 1 });
    assert.equal(calls.length, 2);
    assert.ok(clock.now() - t0 >= 3000);
    assert.equal(client.stats.status429, 1);
  });

  it('429 Retry-After가 없으면 10초', async () => {
    const { client, clock } = setup([json(429, {}), json(200, {})]);
    const t0 = clock.now();
    await client.getMatch('KR_1');
    assert.ok(clock.now() - t0 >= 10_000);
  });

  it('429가 6번 연속이면 포기 (재시도 5번)', async () => {
    const { client, calls } = setup(Array.from({ length: 6 }, () => json(429, {}, { 'retry-after': '1' })));
    await assert.rejects(client.getMatch('KR_1'), RiotRetryExhaustedError);
    assert.equal(calls.length, 6);
  });

  it('503 → 1·2·4초 3번 재시도 후 포기', async () => {
    const { client, calls, clock } = setup(Array.from({ length: 4 }, () => json(503, {})));
    await assert.rejects(client.getMatch('KR_1'), RiotRetryExhaustedError);
    assert.equal(calls.length, 4);
    assert.deepEqual(clock.slept.filter((x) => x >= 1000), [1000, 2000, 4000]);
  });

  it('503 다음 200이면 성공', async () => {
    const { client } = setup([json(503, {}), json(200, { a: 1 })]);
    assert.deepEqual(await client.getMatch('KR_1'), { a: 1 });
  });

  it('네트워크 오류도 일시 오류로 재시도', async () => {
    const { client, calls } = setup([
      () => {
        throw new TypeError('fetch failed');
      },
      json(200, { a: 1 }),
    ]);
    assert.deepEqual(await client.getMatch('KR_1'), { a: 1 });
    assert.equal(calls.length, 2);
  });

  it('404 → RiotNotFoundError, 400 → RiotBadRequestError', async () => {
    const a = setup([json(404, {})]);
    await assert.rejects(a.client.getTimeline('KR_1'), RiotNotFoundError);
    const b = setup([json(400, {})]);
    await assert.rejects(b.client.getMatch('KR_1'), RiotBadRequestError);
  });

  // 전적 검색용 메서드 4개 (back_spec 변경 03 W-2)
  it('getAccountByRiotId: 지역 라우팅, gameName/tagLine이 경로에 인코딩됨', async () => {
    const { client, calls } = setup([json(200, { puuid: 'P1', gameName: '너 희', tagLine: 'KR1' })]);
    const account = await client.getAccountByRiotId('너 희', 'KR1');
    assert.deepEqual(account, { puuid: 'P1', gameName: '너 희', tagLine: 'KR1' });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]!.url,
      `https://asia.example/riot/account/v1/accounts/by-riot-id/${encodeURIComponent('너 희')}/KR1`,
    );
  });

  it('getSummonerByPuuid: 플랫폼 라우팅', async () => {
    const { client, calls } = setup([json(200, { profileIconId: 1, summonerLevel: 300 })]);
    assert.deepEqual(await client.getSummonerByPuuid('PUUID_X'), { profileIconId: 1, summonerLevel: 300 });
    assert.equal(calls[0]!.url, 'https://kr.example/lol/summoner/v4/summoners/by-puuid/PUUID_X');
  });

  it('getLeagueEntriesByPuuid: 플랫폼 라우팅, 언랭크면 빈 배열', async () => {
    const { client, calls } = setup([json(200, [])]);
    assert.deepEqual(await client.getLeagueEntriesByPuuid('PUUID_X'), []);
    assert.equal(calls[0]!.url, 'https://kr.example/lol/league/v4/entries/by-puuid/PUUID_X');
  });

  it('getRecentMatchIds: 지역 라우팅, 큐 필터 없음', async () => {
    const { client, calls } = setup([json(200, ['KR_1', 'KR_2'])]);
    assert.deepEqual(await client.getRecentMatchIds('PUUID_X', { start: 0, count: 20 }), ['KR_1', 'KR_2']);
    assert.equal(calls[0]!.url, 'https://asia.example/lol/match/v5/matches/by-puuid/PUUID_X/ids?start=0&count=20');
  });

  it('account-v1 404 → RiotNotFoundError', async () => {
    const { client } = setup([json(404, {})]);
    await assert.rejects(client.getAccountByRiotId('없음', 'KR1'), RiotNotFoundError);
  });

  it('오류 path에 puuid 전체가 남지 않는다', async () => {
    const { client } = setup([json(404, {})]);
    const puuid = 'A'.repeat(78);
    await assert.rejects(client.getMatchIds(puuid, { queue: 420, start: 0, count: 20, startTime: 1790816400 }), (err: RiotNotFoundError) => {
      assert.ok(!err.path.includes(puuid));
      return true;
    });
  });
});
