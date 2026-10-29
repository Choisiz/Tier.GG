"use client";

import Tooltip from "@/components/common/Tooltip";
import { formatLanePercent, laneTone, type LaneTone } from "@/lib/view/laneGold";
import { useLaneState } from "./LaneGoldProvider";

const TONE_CLASS: Record<LaneTone, string> = {
  ahead: "text-win",
  even: "text-foreground",
  behind: "text-lose",
};

const READY_TIP = "라인전: 15분 시점 골드 비율 (내 쪽 : 같은 포지션 상대 쪽). 앞선 쪽이 더 큰 숫자";
const NONE_TIP =
  "15분 골드를 구할 수 없는 게임입니다 (짧은 게임이거나 상대 포지션을 특정할 수 없음)";

/**
 * 매치 행 CS 칸의 "라인전 45:55" 한 줄 (변경 08). 줄 높이는 16px로 고정해
 * 자리표시(회색 막대) → 값으로 바뀌어도 행 높이·너비가 변하지 않는다.
 * 읽어주는 글은 sr-only 하나뿐이고, 로딩→결과 변경은 aria-live를 쓰지 않는다 (행 20개가 한꺼번에 읽히지 않게).
 */
export default function LaneGoldCell({ matchId }: { matchId: string }) {
  const state = useLaneState(matchId);

  if (state.kind === "loading") {
    return (
      <p className="h-4 text-xs leading-4">
        <span aria-hidden="true" className="text-muted">
          라인전{" "}
        </span>
        <span
          aria-hidden="true"
          className="inline-block h-3 w-10 animate-pulse rounded bg-border align-middle motion-reduce:animate-none"
        />
        <span className="sr-only">라인전 불러오는 중</span>
      </p>
    );
  }

  if (state.kind === "ready") {
    return (
      <p className="h-4 text-xs leading-4">
        <Tooltip content={READY_TIP} className="gap-1">
          <span aria-hidden="true" className="text-muted">
            라인전
          </span>
          <span aria-hidden="true" className={`tabular-nums ${TONE_CLASS[laneTone(state.myPercent)]}`}>
            {formatLanePercent(state.myPercent)}
          </span>
          <span className="sr-only">
            라인전 15분 골드 비율 내 쪽 {state.myPercent} 상대 쪽 {100 - state.myPercent}
          </span>
        </Tooltip>
      </p>
    );
  }

  // idle(서버 렌더) · none: "-"
  return (
    <p className="h-4 text-xs leading-4">
      <Tooltip content={NONE_TIP} className="gap-1">
        <span aria-hidden="true" className="text-muted">
          라인전
        </span>
        <span aria-hidden="true">-</span>
        <span className="sr-only">라인전 정보 없음</span>
      </Tooltip>
    </p>
  );
}
