// summonerSearch: 캐시 미스→적중, 404, 401/403, 429(재시도 소진), 매치 일부 실패, 캐시 키 정규화 (back_spec 변경 03 W-10 #2)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RiotClient } from '../../src/riot/client.js';
import { RiotKeyExpiredError, RiotNotFoundError, RiotRetryExhaustedError } from '../../src/riot/errors.js';
import { createSummonerCache } from '../../src/api/summonerCache.js';
import { createSummonerSearch } from '../../src/api/summonerSearch.js';
import { ApiError } from '../../src/api/errors.js';
import type { SummonerSearchDto } from '../../src/api/dto.js';
import { silentLogger } from '../../src/lib/logger.js';
import { clone, loadMatch } from '../helpers/fixture.js';

const ACCOUNT = { puuid: 'TEST_PUUID_01', gameName: '너희는개다', tagLine: 'KR1' };
const SUMMONER = { profileIconId: 10, summonerLevel: 300 };
const LEAGUES = [
  { queueType: 'RANKED_SOLO_5x5', tier: 'EMERALD', rank: 'II', leaguePoints: 54, wins: 120, losses: 110, hotStreak: false },
];

interface FakeRiotCalls {
  account: { gameName: string; tagLine: string }[];
  summoner: string[];
  leagues: string[];
  ids: string[];
  match: string[];
}

function fakeRiot(overrides: Partial<RiotClient> = {}, calls: FakeRiotCalls = { account: [], summoner: [], leagues: [], ids: [], match: [] }) {
  const riot = {
    async getAccountByRiotId(gameName: string, tagLine: string) {
      calls.account.push({ gameName, tagLine });
      return ACCOUNT;
    },
    async getSummonerByPuuid(puuid: string) {
      calls.summoner.push(puuid);
      return SUMMONER;
    },
    async getLeagueEntriesByPuuid(puuid: string) {
      calls.leagues.push(puuid);
      return LEAGUES;
    },
    async getRecentMatchIds(puuid: string, _q: unknown) {
      calls.ids.push(puuid);
      return ['KR_8408851980'];
    },
    async getMatch(id: string) {
      calls.match.push(id);
      const m = clone(loadMatch());
      m.metadata.matchId = id;
      return m;
    },
    ...overrides,
  };
  return { riot: riot as unknown as RiotClient, calls };
}

function setup(overrides: Partial<RiotClient> = {}) {
  const { riot, calls } = fakeRiot(overrides);
  const cache = createSummonerCache<SummonerSearchDto>(60_000, 10);
  let t = 0;
  const search = createSummonerSearch({ riot, cache, logger: silentLogger, now: () => t });
  return { search, calls, advance: (ms: number) => (t += ms) };
}

describe('summonerSearch', () => {
  it('정상 흐름: account→summoner+league(병렬)→ids→match, DTO 형식', async () => {
    const { search, calls } = setup();
    const r = await search('kr', '너희는개다', 'KR1');
    assert.deepEqual(calls.account, [{ gameName: '너희는개다', tagLine: 'KR1' }]);
    assert.deepEqual(calls.summoner, ['TEST_PUUID_01']);
    assert.deepEqual(calls.leagues, ['TEST_PUUID_01']);
    assert.deepEqual(calls.ids, ['TEST_PUUID_01']);
    assert.deepEqual(calls.match, ['KR_8408851980']);
    assert.deepEqual(r.summoner, { puuid: 'TEST_PUUID_01', gameName: '너희는개다', tagLine: 'KR1', profileIconId: 10, summonerLevel: 300 });
    assert.deepEqual(r.leagues, LEAGUES);
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0]!.matchId, 'KR_8408851980');
    assert.equal(r.matches[0]!.win, true);
    assert.equal(r.matches[0]!.championId, 23);
    assert.deepEqual(r.matches[0]!.participants.team.length, 5);
    assert.deepEqual(r.matches[0]!.participants.enemy.length, 5);
  });

  it('캐시 미스 뒤 같은 요청은 적중해 Riot을 다시 부르지 않는다 (TTL 안)', async () => {
    const { search, calls } = setup();
    await search('kr', '너희는개다', 'KR1');
    await search('kr', '너희는개다', 'KR1');
    assert.equal(calls.account.length, 1);
  });

  it('캐시 키는 지역:소문자이름#소문자태그로 정규화된다 (대소문자 달라도 같은 캐시)', async () => {
    const { search, calls } = setup();
    await search('kr', '너희는개다', 'KR1');
    await search('kr', '너희는개다', 'kr1');
    assert.equal(calls.account.length, 1);
  });

  it('TTL(60초)이 지나면 다시 Riot을 부른다', async () => {
    const { search, calls, advance } = setup();
    await search('kr', '너희는개다', 'KR1');
    advance(60_000);
    await search('kr', '너희는개다', 'KR1');
    assert.equal(calls.account.length, 2);
  });

  it('account-v1 404 → 404 SUMMONER_NOT_FOUND, 캐시되지 않음', async () => {
    const calls: FakeRiotCalls = { account: [], summoner: [], leagues: [], ids: [], match: [] };
    const { riot } = fakeRiot(
      {
        async getAccountByRiotId(gameName: string, tagLine: string) {
          calls.account.push({ gameName, tagLine });
          throw new RiotNotFoundError('없음', 404, 'p');
        },
      },
      calls,
    );
    const cache = createSummonerCache<SummonerSearchDto>(60_000, 10);
    const search = createSummonerSearch({ riot, cache, logger: silentLogger, now: () => 0 });
    await assert.rejects(search('kr', '없음', 'KR1'), (err: ApiError) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'SUMMONER_NOT_FOUND');
      return true;
    });
    assert.equal(cache.get('kr:없음#kr1', 0), undefined);
    assert.equal(calls.account.length, 1);
  });

  it('401/403 → 503 RIOT_KEY_EXPIRED, 이 요청만 실패(예외를 던지지 않고 거부만)', async () => {
    const { riot } = fakeRiot({
      async getSummonerByPuuid() {
        throw new RiotKeyExpiredError('만료', 401, 'p');
      },
    });
    const cache = createSummonerCache<SummonerSearchDto>(60_000, 10);
    const search = createSummonerSearch({ riot, cache, logger: silentLogger, now: () => 0 });
    await assert.rejects(search('kr', '너희는개다', 'KR1'), (err: ApiError) => {
      assert.equal(err.status, 503);
      assert.equal(err.code, 'RIOT_KEY_EXPIRED');
      return true;
    });
  });

  it('429 재시도 소진(RiotRetryExhaustedError) → 502 RIOT_UNAVAILABLE', async () => {
    const { riot } = fakeRiot({
      async getLeagueEntriesByPuuid() {
        throw new RiotRetryExhaustedError('재시도 소진', 429, 'p');
      },
    });
    const cache = createSummonerCache<SummonerSearchDto>(60_000, 10);
    const search = createSummonerSearch({ riot, cache, logger: silentLogger, now: () => 0 });
    await assert.rejects(search('kr', '너희는개다', 'KR1'), (err: ApiError) => {
      assert.equal(err.status, 502);
      assert.equal(err.code, 'RIOT_UNAVAILABLE');
      return true;
    });
  });

  it('언랭크(league 빈 배열)·최근 게임 없음(ids 빈 배열)은 오류가 아니다', async () => {
    const { riot } = fakeRiot({
      async getLeagueEntriesByPuuid() {
        return [];
      },
      async getRecentMatchIds() {
        return [];
      },
    });
    const cache = createSummonerCache<SummonerSearchDto>(60_000, 10);
    const search = createSummonerSearch({ riot, cache, logger: silentLogger, now: () => 0 });
    const r = (await search('kr', '너희는개다', 'KR1')) as { leagues: unknown[]; matches: unknown[] };
    assert.deepEqual(r.leagues, []);
    assert.deepEqual(r.matches, []);
  });

  it('매치 상세 일부만 실패해도 나머지로 응답(20건 전부 실패해도 matches: [])', async () => {
    let n = 0;
    const { riot } = fakeRiot({
      async getRecentMatchIds() {
        return ['KR_1', 'KR_2', 'KR_3'];
      },
      async getMatch(id: string) {
        n++;
        if (id === 'KR_2') throw new RiotRetryExhaustedError('실패', 503, 'p');
        const m = clone(loadMatch());
        m.metadata.matchId = id;
        return m;
      },
    });
    const cache = createSummonerCache<SummonerSearchDto>(60_000, 10);
    const search = createSummonerSearch({ riot, cache, logger: silentLogger, now: () => 0 });
    const r = (await search('kr', '너희는개다', 'KR1')) as { matches: { matchId: string }[] };
    assert.equal(n, 3);
    assert.deepEqual(r.matches.map((m) => m.matchId), ['KR_1', 'KR_3']);

    const { riot: allFail } = fakeRiot({
      async getRecentMatchIds() {
        return ['KR_1', 'KR_2'];
      },
      async getMatch() {
        throw new RiotRetryExhaustedError('실패', 503, 'p');
      },
    });
    const cache2 = createSummonerCache<SummonerSearchDto>(60_000, 10);
    const search2 = createSummonerSearch({ riot: allFail, cache: cache2, logger: silentLogger, now: () => 0 });
    const r2 = (await search2('kr', '너희는개다', 'KR1')) as { matches: unknown[] };
    assert.deepEqual(r2.matches, []);
  });
});
