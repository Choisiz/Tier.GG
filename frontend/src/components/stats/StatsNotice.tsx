/** 통계 대신 보여줄 안내 종류 */
export type StatsNoticeKind = "not_ready" | "not_found" | "unavailable" | "empty_position";

const MESSAGES: Record<StatsNoticeKind, string> = {
  not_ready: "아직 집계된 통계가 없습니다. 매일 05:00(KST)에 집계됩니다.",
  not_found: "최근 14일 통계가 없습니다.",
  unavailable: "통계 서버에 연결하지 못했습니다.",
  empty_position: "이 포지션의 최근 14일 통계가 아직 없습니다.",
};

/** 집계 전 / 통계 없음 / 서버 연결 실패 안내 상자 */
export default function StatsNotice({ kind }: { kind: StatsNoticeKind }) {
  return (
    <p
      role={kind === "unavailable" ? "status" : undefined}
      className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-muted"
    >
      {MESSAGES[kind]}
    </p>
  );
}
