import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MatchSummary from "@/components/summoners/MatchSummary";
import MatchList from "@/components/summoners/MatchList";
import ProfileHeader from "@/components/summoners/ProfileHeader";
import RankList from "@/components/summoners/RankList";
import SummonerStatus from "@/components/summoners/SummonerStatus";
import { getSummoner } from "@/lib/api/api";
import {
  getChampionKeyMap,
  getItems,
  getLatestVersion,
  getRuneTrees,
  getSummonerSpells,
} from "@/lib/ddragon/api";
import { toKeystoneMap, toSummonerPageView } from "@/lib/view/summoner";

// 전적 검색은 통계 화면과 달리 요청마다 그 자리에서 Riot 값을 받아온다 (window 없음, D36)
export const dynamic = "force-dynamic";

type Props = PageProps<"/summoners/[region]/[riotId]">;

/**
 * 동적 라우트 `params`는 URL 인코딩된 그대로 온다(디코딩되지 않음, Next 16.4 확인).
 * 형식이 잘못돼 디코딩이 실패하면 원문을 그대로 쓴다.
 */
function decodeRiotId(riotId: string): string {
  try {
    return decodeURIComponent(riotId);
  } catch {
    return riotId;
  }
}

/** "너희는개다-KR1" → "너희는개다#KR1" (제목용, 마지막 "-"에서 자름) */
function riotIdDisplayName(riotId: string): string {
  const decoded = decodeRiotId(riotId);
  const lastDash = decoded.lastIndexOf("-");
  if (lastDash <= 0) return decoded;
  return `${decoded.slice(0, lastDash)}#${decoded.slice(lastDash + 1)}`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { region, riotId } = await params;
  if (region !== "kr") {
    return { title: "전적 검색" };
  }
  return { title: `${riotIdDisplayName(riotId)} 전적` };
}

export default async function SummonerPage({ params }: Props) {
  const { region, riotId } = await params;
  if (region !== "kr") {
    // 계약상 kr 외에는 400(INVALID_PARAMETER) — 프론트가 미리 막는다
    notFound();
  }

  const state = await getSummoner(region, decodeRiotId(riotId));
  if (state.status === "not_found" || state.status === "invalid") {
    notFound();
  }
  if (state.status === "riot_unavailable") {
    return (
      <SummonerStatus
        message="라이엇 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요."
        showRetry
      />
    );
  }
  if (state.status === "riot_key_expired") {
    // 개발 단계 24시간 키 안내는 화면에 쓰지 않는다 (운영 메시지와 개발 사정을 섞지 않음, 4장)
    return <SummonerStatus message="지금은 전적을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요." />;
  }
  if (state.status === "unavailable") {
    return (
      <SummonerStatus message="서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." showRetry />
    );
  }

  // force-dynamic이라 렌더 시각 = 조회 시각. 갱신하기 쿨다운·"N분 전 조회"의 기준이다 (변경 09)
  const fetchedAt = new Date().toISOString();
  const response = state.data;
  const itemIds = new Set<number>();
  for (const match of response.matches) {
    for (const itemId of match.items) {
      if (itemId !== 0) itemIds.add(itemId);
    }
    if (match.trinket !== 0) itemIds.add(match.trinket);
  }

  const [version, champions, items, spells, runeTrees] = await Promise.all([
    getLatestVersion(),
    getChampionKeyMap(),
    getItems([...itemIds], []),
    getSummonerSpells(),
    getRuneTrees(),
  ]);

  const view = toSummonerPageView(response, version, {
    champions,
    items,
    spells,
    keystones: toKeystoneMap(runeTrees),
  });

  return (
    <div className="space-y-6">
      <ProfileHeader profile={view.profile} headline={view.headline} fetchedAt={fetchedAt} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr] lg:items-start">
        <RankList solo={view.soloLeague} flex={view.flexLeague} />
        <section aria-labelledby="matches-heading" className="min-w-0">
          <h2 id="matches-heading" className="sr-only">
            최근 매치
          </h2>
          {view.matches.length > 0 && <MatchSummary summary={view.summary} />}
          <MatchList matches={view.matches} puuid={response.summoner.puuid} />
        </section>
      </div>
    </div>
  );
}
