import type { Tier } from "@/lib/api/types";

/** 티어 배지 색 (글자 #09090b 기준 대비 7:1 이상). 색은 보조, 글자가 항상 함께 보인다 */
const TIER_CLASSES: Record<Exclude<Tier, null>, string> = {
  1: "bg-red-400 text-zinc-950",
  2: "bg-orange-400 text-zinc-950",
  3: "bg-yellow-400 text-zinc-950",
  4: "bg-green-400 text-zinc-950",
  5: "bg-sky-400 text-zinc-950",
};

type TierBadgeProps = {
  tier: Tier;
  /** 표본 부족 기준 판 수 (`/meta` rules.minTierPick) */
  minTierPick: number;
  /** "표본 부족 (50게임 미만)"처럼 기준을 글자로 붙일지 */
  showThreshold?: boolean;
};

/** 1~5티어 / 표본 부족 배지 (서버·클라이언트 공용) */
export default function TierBadge({ tier, minTierPick, showThreshold = false }: TierBadgeProps) {
  if (tier === null) {
    const reason = `최근 14일 ${minTierPick}게임 미만이라 티어를 매기지 않았습니다`;
    return (
      <span
        title={reason}
        className="inline-flex shrink-0 items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-muted"
      >
        표본 부족{showThreshold ? ` (${minTierPick}게임 미만)` : ""}
        <span className="sr-only"> ({reason})</span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-bold whitespace-nowrap ${TIER_CLASSES[tier]}`}
    >
      {tier}티어
    </span>
  );
}
