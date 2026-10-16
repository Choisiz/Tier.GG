import type { WindowInfoView } from "@/lib/view/format";

/**
 * 통계 기간 한 줄: "최근 14일 · 3,952게임 · 26.20 67% / 26.19 33% · 10월 15일 03:52 집계".
 * `isStale`이면 노란 안내 상자를 덧붙인다 (숫자는 그대로).
 */
export default function WindowInfo({ info }: { info: WindowInfoView }) {
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap gap-x-1.5 text-xs text-muted sm:text-sm">
        <span>최근 {info.days}일</span>
        <span aria-hidden="true">·</span>
        <span>{info.games}게임</span>
        <span aria-hidden="true">·</span>
        <span>{info.patchMix}</span>
        <span aria-hidden="true">·</span>
        <span>{info.aggregatedAt} 집계</span>
      </p>
      {info.isStale ? (
        <p
          role="status"
          className="rounded-md border border-yellow-400/60 bg-yellow-400/10 px-3 py-2 text-sm text-yellow-200"
        >
          통계 갱신이 지연되고 있습니다 (마지막 집계 {info.aggregatedAt})
        </p>
      ) : null}
    </div>
  );
}
