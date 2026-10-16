import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ChampionAbilities from "@/components/champions/ChampionAbilities";
import ChampionHero from "@/components/champions/ChampionHero";
import ChampionLore from "@/components/champions/ChampionLore";
import PositionStatsPanel, {
  type PositionPanelView,
} from "@/components/champions/PositionStatsPanel";
import PositionTabs from "@/components/champions/PositionTabs";
import StatsNotice from "@/components/stats/StatsNotice";
import WindowInfo from "@/components/stats/WindowInfo";
import { getChampionStats, getMeta, requireStats } from "@/lib/api/api";
import { POSITION_LABELS, tierListHref } from "@/lib/api/positions";
import type { ChampionStatsResponse, PositionSummary } from "@/lib/api/types";
import {
  getChampionDetail,
  getChampionList,
  getItems,
  getRuneTrees,
  getSummonerSpells,
} from "@/lib/ddragon/api";
import type { ChampionDetail } from "@/lib/ddragon/types";
import { toCoreItems, toRunePage, toSkillOrders, toSpellCombo } from "@/lib/view/builds";
import { formatCount, formatPercent, toWindowInfoView } from "@/lib/view/format";

// 빌드 시 전 챔피언 정적 생성 + ISR. dynamicParams는 기본값(true) 유지.
export const revalidate = 3600;

/** `/meta`를 못 받았을 때 쓰는 표본 부족 기준 */
const DEFAULT_MIN_TIER_PICK = 50;

export async function generateStaticParams() {
  const champions = await getChampionList();
  return champions.map((champion) => ({ championId: champion.id }));
}

export async function generateMetadata({
  params,
}: PageProps<"/champions/[championId]">): Promise<Metadata> {
  const { championId } = await params;
  // Data Dragon 실패 시 빈 제목 대신 기본 제목 (변경 01 D7)
  let champion: ChampionDetail | null;
  try {
    champion = await getChampionDetail(championId);
  } catch {
    return { title: "챔피언" };
  }
  if (!champion) {
    return { title: "챔피언을 찾을 수 없습니다" };
  }
  return {
    title: `${champion.name} - ${champion.title}`,
    description: `${champion.name}(${champion.title})의 포지션별 티어, 추천 룬·아이템·스킬, 스킨, 스토리`,
  };
}

/** API 응답 1개 + Data Dragon → 한 포지션 패널 데이터 */
async function toPanelView(
  response: ChampionStatsResponse,
  champion: ChampionDetail,
): Promise<PositionPanelView> {
  const { stats, builds } = response;
  const [items, spells, runeTrees] = await Promise.all([
    getItems(
      builds.items.map((item) => item.itemId),
      response.window.patches.map((patch) => patch.patch),
    ),
    getSummonerSpells(),
    getRuneTrees(),
  ]);
  return {
    tier: stats.tier,
    winRate: formatPercent(stats.winRate),
    pickRate: formatPercent(stats.pickRate),
    banRate: formatPercent(stats.banRate),
    pick: formatCount(stats.pick),
    runes: builds.runes.map((rune) => toRunePage(rune, runeTrees)),
    spells: builds.spells.map((spell) => toSpellCombo(spell, spells)),
    skills: toSkillOrders(builds.skills, champion.abilities),
    items: toCoreItems(builds.items, items, `${champion.id} ${response.position}`),
  };
}

/** 탭 글자 "탑 · 2티어 · 90%" */
function tabLabel(summary: PositionSummary): string {
  const tier = summary.tier === null ? "표본 부족" : `${summary.tier}티어`;
  return `${POSITION_LABELS[summary.position]} · ${tier} · ${Math.round(summary.positionShare)}%`;
}

/**
 * 1순위(포지션 없이) + 2순위(있으면) 응답. 2순위가 통계 없음 등으로 실패하면 그 탭만 뺀다.
 * 서비스 중 연결 실패는 requireStats가 오류를 던진다 (직전 정상 페이지 유지).
 */
async function loadChampionStats(championKey: string, championId: string) {
  const first = requireStats(await getChampionStats(championKey));
  if (first.status !== "ok") {
    return { state: first.status, responses: [] as ChampionStatsResponse[] };
  }
  const responses = [first.data];
  const second = first.data.positions.find((p) => p.position !== first.data.position);
  if (second) {
    const secondState = requireStats(await getChampionStats(championKey, second.position));
    if (secondState.status === "ok") {
      if (secondState.data.window.aggregatedAt !== first.data.window.aggregatedAt) {
        console.warn(
          `[stats] ${championId} 두 포지션 응답의 집계 시각이 다릅니다. 1순위 기간을 표시합니다.`,
        );
      }
      responses.push(secondState.data);
    }
  }
  return { state: "ok" as const, responses };
}

export default async function ChampionDetailPage({
  params,
}: PageProps<"/champions/[championId]">) {
  const { championId } = await params;
  const champion = await getChampionDetail(championId);
  if (!champion) {
    notFound();
  }

  const [{ state, responses }, meta] = await Promise.all([
    loadChampionStats(champion.key, champion.id),
    getMeta(),
  ]);
  const minTierPick =
    meta.status === "ok" ? meta.data.rules.minTierPick : DEFAULT_MIN_TIER_PICK;

  const primary = responses[0];
  const tabs = await Promise.all(
    responses.map(async (response) => {
      const summary = primary.positions.find((p) => p.position === response.position);
      const label = POSITION_LABELS[response.position];
      return {
        key: response.position,
        label: summary ? tabLabel(summary) : label,
        title: label,
        panel: (
          <PositionStatsPanel
            view={await toPanelView(response, champion)}
            minTierPick={minTierPick}
          />
        ),
      };
    }),
  );

  const backPosition = primary?.position ?? "TOP";

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <Link
          href={tierListHref(backPosition)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-foreground"
        >
          <span aria-hidden="true">←</span> {POSITION_LABELS[backPosition]} 티어 목록
        </Link>
        <ChampionHero champion={champion} />
      </div>

      <section aria-labelledby="stats-heading" className="space-y-4">
        <div className="space-y-2">
          <h2 id="stats-heading" className="text-xl font-bold">
            포지션별 통계와 추천 빌드
          </h2>
          {primary ? <WindowInfo info={toWindowInfoView(primary.window)} /> : null}
        </div>
        {state === "ok" && tabs.length > 0 ? (
          <PositionTabs tabs={tabs} />
        ) : (
          <StatsNotice kind={state === "ok" ? "not_found" : state} />
        )}
      </section>

      <ChampionAbilities abilities={champion.abilities} />
      <ChampionLore lore={champion.lore} />
    </div>
  );
}
