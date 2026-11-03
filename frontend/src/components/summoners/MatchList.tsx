import type { MatchView } from "@/lib/view/summoner";
import FeedbackProvider from "./FeedbackProvider";
import LaneGoldProvider from "./LaneGoldProvider";
import MatchRow from "./MatchRow";

/** 최근 매치 최대 20건. 비어 있으면 안내 문구 */
export default function MatchList({
  matches,
  puuid,
}: {
  matches: MatchView[];
  /** 라인전 15분 골드 지연 로딩(변경 08)·AI 게임 분석(변경 10)에 쓴다 */
  puuid: string;
}) {
  if (matches.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-muted">
        최근 플레이한 게임이 없습니다
      </p>
    );
  }
  return (
    <LaneGoldProvider key={puuid} puuid={puuid} matchIds={matches.map((match) => match.matchId)}>
      <FeedbackProvider key={puuid} puuid={puuid}>
        <ol className="flex flex-col gap-2" aria-label="최근 매치 목록">
          {matches.map((match) => (
            <li key={match.matchId}>
              <MatchRow match={match} />
            </li>
          ))}
        </ol>
      </FeedbackProvider>
    </LaneGoldProvider>
  );
}
