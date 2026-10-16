import type { Position, Tier, TierRow } from "@/lib/api/types";
import type { ChampionSummary } from "@/lib/ddragon/types";
import { formatCount, formatPercent } from "./format";

/** 티어 표 1행 (클라이언트로 넘기는 가공 데이터) */
export type TierListRowView = {
  rank: number;
  championKey: number;
  /** Data Dragon 영문 id. Data Dragon에 없는 챔피언이면 없음 (링크·아이콘 없음) */
  id?: string;
  name: string;
  iconUrl?: string;
  tier: Tier;
  winRate: string;
  pickRate: string;
  banRate: string;
  pick: string;
  /** 다른 주 포지션 화면 이름 ("미드") */
  otherMainPosition?: string;
};

/**
 * API 행 + Data Dragon → 표 행. 순서는 API(`rank`) 그대로 둔다 (계약 2-3).
 * @param positionLabels 포지션 화면 이름 표
 */
export function toTierListRows(
  rows: TierRow[],
  position: Position,
  championsByKey: Map<string, ChampionSummary>,
  positionLabels: Record<Position, string>,
): TierListRowView[] {
  const unknown: number[] = [];
  const result = rows.map((row): TierListRowView => {
    const champion = championsByKey.get(String(row.championId));
    if (!champion) unknown.push(row.championId);
    const other = row.mainPositions.find((p) => p !== position);
    return {
      rank: row.rank,
      championKey: row.championId,
      id: champion?.id,
      name: champion?.name ?? `챔피언 #${row.championId}`,
      iconUrl: champion?.iconUrl,
      tier: row.tier,
      winRate: formatPercent(row.winRate),
      pickRate: formatPercent(row.pickRate),
      banRate: formatPercent(row.banRate),
      pick: formatCount(row.pick),
      otherMainPosition: other ? positionLabels[other] : undefined,
    };
  });
  if (unknown.length > 0) {
    console.warn(`[view] Data Dragon에 없는 championId (${position}): ${unknown.join(", ")}`);
  }
  return result;
}
