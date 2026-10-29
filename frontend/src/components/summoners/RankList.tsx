import Image from "next/image";
import type { LeagueView } from "@/lib/view/summoner";

function RankCard({ label, league }: { label: string; league: LeagueView | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-2 text-xs font-semibold text-muted">{label}</p>
      {league ? <Ranked league={league} /> : <Unranked />}
    </div>
  );
}

function Ranked({ league }: { league: LeagueView }) {
  return (
    <div className="flex items-center gap-3">
      {league.tierEmblemUrl ? (
        <span className="relative block size-12 shrink-0">
          <Image src={league.tierEmblemUrl} alt="" fill sizes="48px" className="object-contain" />
        </span>
      ) : (
        <div
          aria-hidden="true"
          className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-bold text-muted"
        >
          {league.tierLabel.charAt(0)}
        </div>
      )}
      <div className="min-w-0">
        <p className="font-bold">
          {league.tierLabel} <span className="font-normal text-muted">{league.leaguePoints} LP</span>
        </p>
        <p className="text-sm text-muted">
          {league.wins}승 {league.losses}패 · {league.winRate}
        </p>
      </div>
    </div>
  );
}

/** 응답에 해당 큐 항목이 없을 때. API는 "배치 중"과 "기록 없음"을 구분해 주지 않아 같은 문구를 쓴다 */
function Unranked() {
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-surface-2 text-xs font-bold text-muted"
      >
        ?
      </div>
      <div className="min-w-0">
        <p className="font-bold text-muted">Unranked</p>
        <p className="text-sm text-muted">이번 시즌 기록 없음</p>
      </div>
    </div>
  );
}

/** 랭크 카드(좌, 세로). 항상 2장: 솔로/듀오 → 자유랭크 (변경 09). 항목이 없으면 Unranked 카드 */
export default function RankList({
  solo,
  flex,
}: {
  solo: LeagueView | null;
  flex: LeagueView | null;
}) {
  return (
    <section aria-label="랭크" className="space-y-3">
      <RankCard label="솔로/듀오" league={solo} />
      <RankCard label="자유랭크" league={flex} />
    </section>
  );
}
