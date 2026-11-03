// 평가 판 가림 (ai_spec 2-9): 10명 계정 식별 값을 가리고, 원래 문자열이 남지 않았는지 검사
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leftovers, maskMatch } from '../../../eval/fetchSet.js';

describe('평가 판 가림', () => {
  it('puuid·닉네임·태그·summonerId·metadata.participants·timeline puuid를 가리고 아이콘·레벨을 지운다', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `REAL-PUUID-${i}-abcdefghij`);
    const match = {
      metadata: { matchId: 'KR_1', participants: [...ids] },
      info: {
        participants: ids.map((p, i) => ({
          participantId: i + 1,
          puuid: p,
          riotIdGameName: `실제닉네임${i}`,
          riotIdTagline: 'KR1',
          summonerId: `SUMMONER-ID-${i}-xyz`,
          profileIcon: 4567,
          summonerLevel: 321,
          championId: 100 + i,
        })),
      },
    };
    const timeline = { metadata: { participants: [...ids] }, info: { participants: ids.map((p, i) => ({ participantId: i + 1, puuid: p })), frames: [] } };
    const { originals } = maskMatch(match, timeline);
    const text = JSON.stringify(match) + JSON.stringify(timeline);
    assert.equal(leftovers(text, originals).long, 0);
    assert.equal(match.info.participants[4]!.puuid, 'TEST_PUUID_05');
    assert.equal(match.info.participants[4]!.riotIdGameName, 'Player05');
    assert.equal(match.info.participants[4]!.profileIcon, 0);
    assert.equal(match.metadata.participants[9], 'TEST_PUUID_10');
    assert.equal(timeline.info.participants[0]!.puuid, 'TEST_PUUID_01');
    assert.equal(match.info.participants[0]!.championId, 100); // 수치·챔피언은 그대로
  });
  it('가리지 않으면 남은 개수를 센다', () => {
    assert.deepEqual(leftovers('abc REAL-PUUID-1 x REAL-PUUID-1', ['REAL-PUUID-1', 'KR1']), { long: 2, short: [] });
  });
});
