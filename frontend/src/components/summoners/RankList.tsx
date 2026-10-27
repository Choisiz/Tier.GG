import type { LeagueView } from "@/lib/view/summoner";

function RankCard({ league }: { league: LeagueView }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-2 text-xs font-semibold text-muted">{league.queueLabel}</p>
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-bold text-muted"
        >
          {league.tierLabel.charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="font-bold">
            {league.tierLabel} <span className="font-normal text-muted">{league.leaguePoints} LP</span>
          </p>
          <p className="text-sm text-muted">
            {league.wins}승 {league.losses}패 · {league.winRate}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 랭크 카드(좌, 세로). 비어 있으면 "랭크 정보가 없습니다" 카드 1개 */
export default function RankList({ leagues }: { leagues: LeagueView[] }) {
  if (leagues.length === 0) {
    return (
      <section aria-label="랭크" className="rounded-lg border border-border bg-surface p-4 text-center text-sm text-muted">
        랭크 정보가 없습니다
      </section>
    );
  }
  return (
    <section aria-label="랭크" className="space-y-3">
      {leagues.map((league) => (
        <RankCard key={league.queueLabel} league={league} />
      ))}
    </section>
  );
}
