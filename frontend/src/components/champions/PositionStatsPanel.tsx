import type { ReactNode } from "react";
import CoreItems from "@/components/champions/CoreItems";
import RunePage from "@/components/champions/RunePage";
import SkillOrder from "@/components/champions/SkillOrder";
import SummonerSpells from "@/components/champions/SummonerSpells";
import TierBadge from "@/components/stats/TierBadge";
import type { Tier } from "@/lib/api/types";
import type {
  CoreItemsView,
  RunePageView,
  SkillOrderSet,
  SpellComboView,
} from "@/lib/view/builds";

/** 한 포지션 패널에 들어가는 가공 데이터 */
export type PositionPanelView = {
  tier: Tier;
  winRate: string;
  pickRate: string;
  banRate: string;
  pick: string;
  runes: RunePageView[];
  spells: SpellComboView[];
  skills: SkillOrderSet;
  items: CoreItemsView;
};

const EMPTY = "표본이 부족해 추천이 없습니다";

function BuildCard({
  title,
  note,
  empty,
  children,
}: {
  title: string;
  note?: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-bold">
        {title}
        {note ? <span className="ml-2 text-xs font-normal text-muted">{note}</span> : null}
      </h3>
      {empty ? <p className="text-sm text-muted">{EMPTY}</p> : children}
    </section>
  );
}

/** 한 포지션의 통계 요약 + 추천 룬·주문·스킬·아이템 */
export default function PositionStatsPanel({
  view,
  minTierPick,
}: {
  view: PositionPanelView;
  minTierPick: number;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <TierBadge tier={view.tier} minTierPick={minTierPick} showThreshold />
        <span>승률 {view.winRate}</span>
        <span aria-hidden="true" className="text-muted">·</span>
        <span>픽률 {view.pickRate}</span>
        <span aria-hidden="true" className="text-muted">·</span>
        <span>밴률 {view.banRate}</span>
        <span aria-hidden="true" className="text-muted">·</span>
        <span>{view.pick}게임</span>
        {view.tier === null ? (
          <span className="w-full text-xs text-muted">표본이 적어 참고용입니다.</span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BuildCard title="추천 룬" empty={view.runes.length === 0}>
          <RunePage pages={view.runes} />
        </BuildCard>
        <div className="space-y-4">
          <BuildCard title="소환사 주문" empty={view.spells.length === 0}>
            <SummonerSpells combos={view.spells} />
          </BuildCard>
          <BuildCard title="스킬 순서" note="1~11레벨" empty={view.skills.builds.length === 0}>
            <SkillOrder set={view.skills} />
          </BuildCard>
          <BuildCard
            title="많이 완성한 아이템"
            note="게임이 끝날 때 가지고 있던 아이템 기준 · 구매 순서 아님"
            empty={view.items.core.length === 0 && !view.items.boots}
          >
            <CoreItems items={view.items} />
          </BuildCard>
        </div>
      </div>
    </div>
  );
}
