// src/api/summonerCache.ts: TTL 만료, 최대 크기 초과 시 가장 오래 넣은 것부터 지움 (back_spec 변경 03 W-3)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSummonerCache } from '../../src/api/summonerCache.js';

describe('summonerCache', () => {
  it('TTL 안이면 적중, 지나면 미스(지연 정리)', () => {
    const cache = createSummonerCache<string>(1000, 10);
    cache.set('k', 'v', 0);
    assert.equal(cache.get('k', 999), 'v');
    assert.equal(cache.get('k', 1000), undefined); // 정확히 TTL 지점은 만료
    assert.equal(cache.get('k', 1000), undefined); // 지연 정리 뒤에도 undefined 유지
  });

  it('없는 키는 undefined', () => {
    const cache = createSummonerCache<string>(1000, 10);
    assert.equal(cache.get('nope', 0), undefined);
  });

  it('최대 크기를 넘으면 가장 오래 넣은 것부터 지운다', () => {
    const cache = createSummonerCache<number>(10_000, 3);
    cache.set('a', 1, 0);
    cache.set('b', 2, 1);
    cache.set('c', 3, 2);
    cache.set('d', 4, 3); // a가 가장 오래됐으므로 지워짐
    assert.equal(cache.get('a', 4), undefined);
    assert.equal(cache.get('b', 4), 2);
    assert.equal(cache.get('c', 4), 3);
    assert.equal(cache.get('d', 4), 4);
  });

  it('같은 키를 다시 넣으면(갱신) "오래된 순서"가 최신으로 바뀐다', () => {
    const cache = createSummonerCache<number>(10_000, 2);
    cache.set('a', 1, 0);
    cache.set('b', 2, 1);
    cache.set('a', 10, 2); // a를 갱신 → 이제 b가 가장 오래됨
    cache.set('c', 3, 3); // 가장 오래된 b가 지워져야 함
    assert.equal(cache.get('a', 4), 10);
    assert.equal(cache.get('b', 4), undefined);
    assert.equal(cache.get('c', 4), 3);
  });

  it('실패 응답은 set()을 부르지 않으면 캐시되지 않는다 (호출하는 쪽 책임)', () => {
    const cache = createSummonerCache<string>(10_000, 10);
    assert.equal(cache.get('k', 0), undefined);
  });
});
