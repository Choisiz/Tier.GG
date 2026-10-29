import Image from "next/image";
import Tooltip from "@/components/common/Tooltip";
import type { MatchSummaryView, MostChampionView } from "@/lib/view/summoner";

/** 카드 배경·테두리를 한 곳에 모은다(D50 C안: 한 단계 밝은 표면 + 위쪽 금색 띠). 띠가 튀면 `border-t-2`나 `border-t-border`로 바꾼다 */
const CARD_CLASS = "mb-3 rounded-lg border border-border border-t-4 border-t-accent bg-surface-2";

/**
 * 승률 도넛. 둘레를 100으로 맞춘 원(r=15.9155)이라 승률 정수 %가 곧 호 길이다.
 * 패 색 원을 깔고 승 색 호를 12시부터 시계 방향으로 덮는다. 0%는 승 호를 그리지 않는다.
 */
function WinRateDonut({ summary }: { summary: MatchSummaryView }) {
  const { count, wins, losses, winRate } = summary;
  return (
    <div
      role="img"
      aria-label={`${count}전 ${wins}승 ${losses}패, 승률 ${winRate}%`}
      className="relative size-16 shrink-0 sm:size-[88px]"
    >
      <svg viewBox="0 0 36 36" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--lose)" strokeWidth="4" />
        {winRate > 0 && (
          <circle
            cx="18"
            cy="18"
            r="15.9155"
            fill="none"
            stroke="var(--win)"
            strokeWidth="4"
            strokeDasharray={`${winRate} ${100 - winRate}`}
          />
        )}
      </svg>
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-base font-bold sm:text-lg"
      >
        {winRate}%
      </span>
    </div>
  );
}

/**
 * 모스트 1칸 (D57·D58). 데스크톱: 초상화 | KDA(굵게) / 승률 · 게임(흐리게) 2줄.
 * 모바일(360px): 3칸 가로 유지, 초상화 | KDA 두 줄("3.42" / "KDA"), 승률 · 게임은 그 아래 한 줄.
 * 한 마크업을 그리드로 바꿔 쓴다(글자 중복 없음).
 */
function MostChampion({ item }: { item: MostChampionView }) {
  const { champion } = item;
  return (
    <li className="grid min-w-0 max-w-28 flex-1 grid-cols-[auto_auto] items-center justify-center gap-x-1.5 gap-y-1 sm:max-w-none sm:flex-none sm:justify-start sm:gap-x-2 sm:gap-y-0">
      <Tooltip content={champion.name} className="sm:row-span-2">
        <span className="relative block size-12 shrink-0 overflow-hidden rounded-md bg-background sm:size-14">
          {champion.iconUrl ? (
            <Image
              src={champion.iconUrl}
              alt={champion.name}
              fill
              sizes="56px"
              className="object-cover"
            />
          ) : (
            <span className="sr-only">{champion.name}</span>
          )}
        </span>
      </Tooltip>
      <p className="whitespace-nowrap text-sm font-semibold leading-tight">
        {item.kda}
        <span className="block text-[11px] font-normal text-muted sm:ml-1 sm:inline sm:text-sm sm:font-semibold sm:text-foreground">
          KDA
        </span>
      </p>
      <p className="col-span-2 justify-self-center whitespace-nowrap text-[11px] text-muted sm:col-span-1 sm:col-start-2 sm:justify-self-start sm:text-xs">
        {item.winRate}% · {item.games}게임
      </p>
    </li>
  );
}

/**
 * 매치 목록 위 "최근 N게임 요약" 카드 (변경 07). 처음 받은 매치 기준이라 스크롤하면 목록과 함께 올라간다.
 * 승/패는 색과 글자를 함께 쓰고, 승률 도넛은 글자 대체(aria-label)를 준다.
 */
export default function MatchSummary({ summary }: { summary: MatchSummaryView }) {
  if (summary.count === 0) {
    return (
      <section
        aria-label="최근 게임 요약"
        className="mb-3 rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted"
      >
        요약할 게임이 없습니다
      </section>
    );
  }
  const basis = `모든 큐 기준${summary.excludedCount > 0 ? ` · 5분 미만 ${summary.excludedCount}게임 제외` : ""}`;
  return (
    <section
      aria-label={`최근 ${summary.count}게임 요약`}
      className={`${CARD_CLASS} p-3 sm:p-4`}
    >
      {/* 기준 문구는 화면에서 지우고(D54) 스크린리더용 sr-only와 `N전`의 title로만 남긴다 */}
      <p className="sr-only">{basis}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
        <div className="flex items-center gap-3">
          <WinRateDonut summary={summary} />
          <div className="min-w-0 text-sm">
            <p className="font-bold" title={basis}>
              {summary.count}전
            </p>
            <p className="whitespace-nowrap">
              <span className="font-bold text-win">{summary.wins}승</span>{" "}
              <span className="font-bold text-lose">{summary.losses}패</span>
            </p>
          </div>
        </div>
        <div>
          <p className="text-sm font-semibold">
            {summary.avgKills} / {summary.avgDeaths} / {summary.avgAssists}
          </p>
          <p className="text-xs text-muted">{summary.kda} KDA</p>
          <p className="text-[11px] text-muted">평균 · (K+A)/D</p>
        </div>
        {summary.most.length > 0 && (
          <div className="col-span-2 border-t border-border pt-3 sm:col-span-1 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
            <p className="mb-1 text-[11px] text-muted">모스트 챔피언</p>
            <ol aria-label="모스트 챔피언" className="flex gap-1 sm:gap-5">
              {summary.most.map((item) => (
                <MostChampion key={item.champion.championId} item={item} />
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  );
}
