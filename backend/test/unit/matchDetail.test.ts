// 변경 06 매치 상세 지표: 2-5 matches[]의 참가자 상세 필드와 팀 요약 (fixture KR_8408851980, 100팀 승리)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchListItem, teamSummary } from '../../src/api/dto.js';
import { clone, loadMatch } from '../helpers/fixture.js';

const real = loadMatch();
const P1 = real.info.participants[0]!.puuid; // 100팀 TOP
const P7 = real.info.participants[6]!.puuid; // 200팀

describe('매치 상세 지표 (변경 06)', () => {
  it('isMe는 10명 중 검색한 소환사 1명만 true', () => {
    const item = matchListItem(real, P7);
    const all = [...item.participants.team, ...item.participants.enemy];
    assert.equal(all.length, 10);
    assert.deepEqual(all.filter((p) => p.isMe).map((p) => p.puuid), [P7]);
    assert.equal(item.participants.team.find((p) => p.isMe)?.championId, item.championId);
  });

  it('참가자 상세 필드를 match-v5 값에서 그대로 꺼낸다', () => {
    const src = real.info.participants[0]!;
    const me = matchListItem(real, P1).participants.team[0]!;
    assert.equal(me.teamPosition, 'TOP');
    assert.equal(me.damageTaken, src.totalDamageTaken);
    assert.equal(me.visionScore, src.visionScore);
    assert.equal(me.wardsPlaced, src.wardsPlaced);
    assert.equal(me.wardsKilled, src.wardsKilled);
    assert.equal(me.controlWardsPlaced, src.detectorWardsPlaced);
    assert.equal(me.cs, src.totalMinionsKilled + src.neutralMinionsKilled);
    assert.deepEqual(me.items, [src.item0, src.item1, src.item2, src.item3, src.item4, src.item5]);
    assert.equal(me.trinket, src.item6);
    assert.deepEqual(me.summonerSpells, [src.summoner1Id, src.summoner2Id]);
    assert.equal(me.keystone, src.perks.styles[0]!.selections[0]!.perk);
    assert.equal(me.subStyle, 8000);
    assert.equal(me.killParticipation, 21); // 기존 matches[].killParticipation과 같은 계산
  });

  it('보조 룬 트리가 없으면 subStyle은 null, 선택 지표가 없으면 0', () => {
    const m = clone(real);
    const p = m.info.participants[0]!;
    p.perks.styles = [p.perks.styles[0]!];
    delete p.visionScore;
    delete p.detectorWardsPlaced;
    const me = matchListItem(m, P1).participants.team[0]!;
    assert.equal(me.subStyle, null);
    assert.equal(me.visionScore, 0);
    assert.equal(me.controlWardsPlaced, 0);
  });

  it('팀 요약: 킬·골드 합과 objectives, 내 팀/상대팀 방향', () => {
    const { teams } = matchListItem(real, P7); // 200팀 관점
    const sum = (id: number, k: 'kills' | 'goldEarned') =>
      real.info.participants.filter((p) => p.teamId === id).reduce((s, p) => s + p[k], 0);
    assert.equal(teams.team.win, false);
    assert.equal(teams.enemy.win, true);
    assert.equal(teams.enemy.kills, sum(100, 'kills'));
    assert.equal(teams.enemy.kills, 39);
    assert.equal(teams.team.gold, sum(200, 'goldEarned'));
    assert.deepEqual(
      { t: teams.enemy.towers, i: teams.enemy.inhibitors, d: teams.enemy.dragons, b: teams.enemy.barons, h: teams.enemy.heralds, g: teams.enemy.grubs },
      { t: 10, i: 2, d: 3, b: 0, h: 1, g: 2 },
    );
  });

  it('bans는 -1(밴 안 함)을 뺀다', () => {
    const { teams } = matchListItem(real, P1);
    assert.deepEqual(teams.team.bans, [64, 7, 902, 101, 17]);
    assert.deepEqual(teams.enemy.bans, [56, 234, 89, 134]);
  });

  it('horde 등 objectives 키가 없으면 0, objectives 자체가 없어도 0', () => {
    const m = clone(real);
    delete m.info.teams[0]!.objectives!.horde;
    delete m.info.teams[1]!.objectives;
    assert.equal(teamSummary(100, m).grubs, 0);
    assert.equal(teamSummary(100, m).towers, 10);
    const enemy = teamSummary(200, m);
    assert.deepEqual([enemy.towers, enemy.dragons, enemy.grubs], [0, 0, 0]);
    assert.equal(enemy.win, false);
  });
});
