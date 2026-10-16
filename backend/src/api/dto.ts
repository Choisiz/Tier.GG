// DB 줄 → 응답 DTO (api_contract 2-3, 2-4). 숫자 변환과 반올림은 statsRepository SQL에서 끝난 상태다.
import type { ItemRow, RuneRow, SkillRow, SpellRow, TierRow } from '../repositories/statsRepository.js';

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
