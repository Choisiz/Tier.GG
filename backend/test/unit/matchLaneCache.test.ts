// 경기 캐시 (back_spec 변경 04, 04-7)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMatchLaneCache, laneInfoFromMatch } from '../../src/api/matchLaneCache.js';
import { clone, loadMatch } from '../helpers/fixture.js';

describe('matchLaneCache', () => {
  it('laneInfoFromMatch: 길이, 참가자 10명의 id·puuid·팀·포지션만 담고 포지션이 이상하면 null', () => {
    const m = clone(loadMatch());
    m.info.participants[3]!.individualPosition = 'Invalid';
    const info = laneInfoFromMatch(m);
    assert.equal(info.durationSec, m.info.gameDuration);
    assert.equal(info.players.length, 10);
    assert.deepEqual(info.players[0], { participantId: 1, puuid: 'TEST_PUUID_01', teamId: 100, position: 'TOP' });
    assert.equal(info.players[3]!.position, null);
    assert.equal(info.gold15, undefined);
    assert.equal(JSON.stringify(info).includes('perks'), false);
  });

  it('TTL 6시간: 직전엔 적중, 6시간이 되면 미스', () => {
    const c = createMatchLaneCache(6 * 3600_000, 10);
    const info = laneInfoFromMatch(loadMatch());
    c.set('KR_1', info, 0);
    assert.ok(c.get('KR_1', 6 * 3600_000 - 1));
    assert.equal(c.get('KR_1', 6 * 3600_000), undefined);
  });

  it('최대 개수를 넘으면 가장 오래 넣은 것부터 지운다', () => {
    const c = createMatchLaneCache(1e9, 3);
    const info = laneInfoFromMatch(loadMatch());
    for (const id of ['KR_1', 'KR_2', 'KR_3', 'KR_4']) c.set(id, info, 0);
    assert.equal(c.get('KR_1', 0), undefined);
    assert.ok(c.get('KR_2', 0));
    assert.ok(c.get('KR_4', 0));
  });
});
