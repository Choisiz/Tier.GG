import Image from "next/image";
import RefreshButton from "@/components/summoners/RefreshButton";
import type { LeagueView, SummonerProfileView } from "@/lib/view/summoner";

type Headline = { league: LeagueView; isFlex: boolean } | null;

/** 이름 아래 티어 줄: 엠블럼·단계·LP·승패·승률(+연승 중). 기준 큐가 자유랭크일 때만 "자유랭크" 접두 */
function TierLine({ headline }: { headline: Headline }) {
  if (!headline) {
    return (
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-surface-2 text-xs font-bold text-muted"
        >
          ?
        </span>
        <b className="text-base text-muted">Unranked</b>
      </div>
    );
  }
  const { league, isFlex } = headline;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex items-center gap-1.5">
        {league.tierEmblemUrl ? (
          <span className="relative block size-7 shrink-0">
            <Image src={league.tierEmblemUrl} alt="" fill sizes="28px" className="object-contain" />
          </span>
        ) : null}
        {isFlex ? <span className="text-sm text-muted">자유랭크</span> : null}
        <b className="text-base">{league.tierLabel}</b>
        <span className="text-sm text-muted">{league.leaguePoints} LP</span>
      </span>
      <span className="text-sm text-muted">
        {league.wins}승 {league.losses}패 · {league.winRate}
      </span>
      {league.hotStreak ? (
        <span className="rounded-full border border-win/50 bg-win/10 px-2 py-0.5 text-xs font-semibold text-win">
          연승 중
        </span>
      ) : null}
    </div>
  );
}

/**
 * 프로필 헤더. 재검색 폼은 없다 — 헤더 전역 검색창과 중복이라 뺀다 (2026-10-27 사용자 교정).
 * 변경 09: 레벨 배지, 티어 줄, 갱신하기 + "N분 전 조회".
 */
export default function ProfileHeader({
  profile,
  headline,
  fetchedAt,
}: {
  profile: SummonerProfileView;
  headline: Headline;
  fetchedAt: string;
}) {
  return (
    <section className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[auto_1fr_auto] sm:gap-x-5 sm:gap-y-2 sm:p-5">
      <span className="relative block size-[72px] shrink-0 sm:row-span-2 sm:size-24">
        <span className="relative block size-full overflow-hidden rounded-lg sm:rounded-xl bg-surface-2">
          <Image src={profile.iconUrl} alt="" fill sizes="96px" className="object-cover" />
        </span>
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-muted sm:px-2.5 sm:text-xs">
          Lv.{profile.level}
        </span>
      </span>
      <h1 className="min-w-0 truncate text-xl font-bold sm:self-end sm:text-2xl">
        {profile.gameName} <span className="font-normal text-muted">#{profile.tagLine}</span>
      </h1>
      <div className="col-span-2 sm:col-span-1 sm:col-start-2 sm:self-start">
        <TierLine headline={headline} />
      </div>
      <div className="col-span-2 sm:col-span-1 sm:col-start-3 sm:row-span-2 sm:row-start-1">
        <RefreshButton fetchedAt={fetchedAt} />
      </div>
    </section>
  );
}
