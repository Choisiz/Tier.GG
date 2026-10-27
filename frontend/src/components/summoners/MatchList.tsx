import type { MatchView } from "@/lib/view/summoner";
import MatchRow from "./MatchRow";

/** 최근 매치 최대 20건. 비어 있으면 안내 문구 */
export default function MatchList({ matches }: { matches: MatchView[] }) {
  if (matches.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-muted">
        최근 플레이한 게임이 없습니다
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-2" aria-label="최근 매치 목록">
      {matches.map((match) => (
        <li key={match.matchId}>
          <MatchRow match={match} />
        </li>
      ))}
    </ol>
  );
}
