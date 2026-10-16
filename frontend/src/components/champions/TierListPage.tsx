import PositionNav from "@/components/champions/PositionNav";
import TierTable from "@/components/champions/TierTable";
import StatsNotice from "@/components/stats/StatsNotice";
import WindowInfo from "@/components/stats/WindowInfo";
import { getMeta, getTierList, requireStats } from "@/lib/api/api";
import { POSITION_LABELS } from "@/lib/api/positions";
import type { Position } from "@/lib/api/types";
import { getChampionKeyMap } from "@/lib/ddragon/api";
import { toWindowInfoView } from "@/lib/view/format";
import { toTierListRows } from "@/lib/view/tierList";

/** `/meta`를 못 받았을 때 쓰는 표본 부족 기준 */
const DEFAULT_MIN_TIER_PICK = 50;

/** 한 포지션 리스트 화면 (탑 = /champions, 나머지 = /champions/lane/{slug}) */
export default async function TierListPage({ position }: { position: Position }) {
  const [tierList, meta, championsByKey] = await Promise.all([
    getTierList(position).then(requireStats),
    getMeta(),
    getChampionKeyMap(),
  ]);

  const minTierPick =
    meta.status === "ok" ? meta.data.rules.minTierPick : DEFAULT_MIN_TIER_PICK;
  const positionLabel = POSITION_LABELS[position];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">챔피언 티어</h1>
        {tierList.status === "ok" ? (
          <WindowInfo info={toWindowInfoView(tierList.data.window)} />
        ) : null}
      </div>

      <PositionNav current={position} />

      {tierList.status === "ok" ? (
        tierList.data.champions.length > 0 ? (
          <TierTable
            rows={toTierListRows(tierList.data.champions, position, championsByKey, POSITION_LABELS)}
            positionLabel={positionLabel}
            minTierPick={minTierPick}
          />
        ) : (
          <StatsNotice kind="empty_position" />
        )
      ) : (
        <StatsNotice kind={tierList.status === "not_found" ? "unavailable" : tierList.status} />
      )}
    </div>
  );
}
