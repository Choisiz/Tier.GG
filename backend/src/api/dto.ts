// DB 줄 → 응답 DTO (api_contract 2-3, 2-4, 2-5). 숫자 변환과 반올림은 statsRepository SQL에서 끝난 상태다.
import type { ItemRow, RuneRow, SkillRow, SpellRow, TierRow } from '../repositories/statsRepository.js';
import type { AccountDto, LeagueEntryByPuuidDto, MatchDto, ParticipantDto, SummonerDto } from '../riot/types.js';

export function tierListItem(rank: number, r: TierRow, mainPositions: string[]) {
  return {
    rank,
    championId: r.championId,
    tier: r.tier,
    tierScore: r.tierScore,
    winRate: r.winRate,
    pickRate: r.pickRate,
    banRate: r.banRate,
    pick: r.pick,
    win: r.win,
    ban: r.ban,
    positionShare: r.positionShare,
    mainPositions,
  };
}

export function positionTab(r: TierRow) {
  return {
    position: r.position,
    pick: r.pick,
    positionShare: r.positionShare,
    tier: r.tier,
    tierScore: r.tierScore,
    winRate: r.winRate,
    pickRate: r.pickRate,
  };
}

export function statsSummary(r: TierRow) {
  return {
    tier: r.tier,
    tierScore: r.tierScore,
    winRate: r.winRate,
    pickRate: r.pickRate,
    banRate: r.banRate,
    pick: r.pick,
    win: r.win,
    ban: r.ban,
  };
}

const rates = (r: { pick: number; win: number; winRate: number; pickRate: number }) => ({
  pick: r.pick,
  win: r.win,
  winRate: r.winRate,
  pickRate: r.pickRate,
});

export const itemDto = (r: ItemRow) => ({ itemId: r.itemId, ...rates(r) });

export const runeDto = (r: RuneRow) => ({
  primaryStyle: r.primaryStyle,
  primaryPerks: [r.primaryPerk1, r.primaryPerk2, r.primaryPerk3, r.primaryPerk4],
  subStyle: r.subStyle,
  subPerks: [r.subPerk1, r.subPerk2],
  statPerks: { offense: r.statOffense, flex: r.statFlex, defense: r.statDefense },
  ...rates(r),
});

export const spellDto = (r: SpellRow) => ({ spellIds: [r.spell1Id, r.spell2Id], ...rates(r) });

export const skillDto = (r: SkillRow) => ({ skillOrder: r.skillOrder, ...rates(r) });

// 전적 검색 (api_contract 2-5, back_spec 변경 03 W-8)

/**
 * 2026-10-27 작은 추가: `riotIdGameName`/`riotIdTagline`은 Riot이 match-v5 응답에 이미 포함해서
 * 주는 필드라(추가 호출 없음), 같은 팀/상대팀 참가자의 닉네임을 그대로 노출한다. 둘 다 없으면
 * `gameName`을 null로 둬 프론트가 "알 수 없는 소환사"로 처리하게 한다 (아주 오래된 게임 등).
 */
function sideDto(p: ParticipantDto) {
  return {
    puuid: p.puuid,
    championId: p.championId,
    win: p.win,
    gameName: p.riotIdGameName || null,
    tagLine: p.riotIdTagline || null,
  };
}

/** 그 매치 1건을 검색한 소환사(puuid) 관점으로 요약한다. 타임라인은 부르지 않는다(스킬 순서는 이번 범위 밖) */
export function matchListItem(match: MatchDto, puuid: string) {
  const participants = match.info.participants;
  const me = participants.find((p) => p.puuid === puuid);
  if (!me) throw new Error('매치 참가자 중 검색한 puuid를 찾을 수 없습니다.');
  const team = participants.filter((p) => p.teamId === me.teamId).map(sideDto);
  const enemy = participants.filter((p) => p.teamId !== me.teamId).map(sideDto);
  const keystone = me.perks.styles[0]?.selections[0]?.perk ?? null;
  return {
    matchId: match.metadata.matchId,
    gameStartAt: new Date(match.info.gameStartTimestamp).toISOString(),
    gameDurationSec: match.info.gameDuration,
    win: me.win,
    championId: me.championId,
    individualPosition: me.individualPosition ?? null,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.totalMinionsKilled + me.neutralMinionsKilled,
    goldEarned: me.goldEarned,
    items: [me.item0, me.item1, me.item2, me.item3, me.item4, me.item5],
    trinket: me.item6,
    summonerSpells: [me.summoner1Id, me.summoner2Id],
    keystone,
    participants: { team, enemy },
  };
}

export type MatchListItem = ReturnType<typeof matchListItem>;

/** GET /api/v1/summoners/:region/:riotId 응답 전체 (api_contract 2-5) */
export function summonerSearchDto(
  account: AccountDto,
  summoner: SummonerDto,
  leagues: LeagueEntryByPuuidDto[],
  matches: MatchDto[],
) {
  return {
    summoner: {
      puuid: account.puuid,
      gameName: account.gameName,
      tagLine: account.tagLine,
      profileIconId: summoner.profileIconId,
      summonerLevel: summoner.summonerLevel,
    },
    leagues: leagues.map((l) => ({
      queueType: l.queueType,
      tier: l.tier,
      rank: l.rank,
      leaguePoints: l.leaguePoints,
      wins: l.wins,
      losses: l.losses,
      hotStreak: l.hotStreak,
    })),
    matches: matches.map((m) => matchListItem(m, account.puuid)),
  };
}

export type SummonerSearchDto = ReturnType<typeof summonerSearchDto>;
