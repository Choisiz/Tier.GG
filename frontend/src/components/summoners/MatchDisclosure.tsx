"use client";

import { useState, type ReactNode } from "react";
import { useFeedback } from "./FeedbackProvider";
import FeedbackPanel from "./FeedbackPanel";
import MatchDetailTabs from "./MatchDetailTabs";

/**
 * 매치 행 + 오른쪽 끝 펼치기 토글 + 펼친 패널 (변경 10, 이전 `MatchExpandToggle` 역할을 옮김).
 * 행 내용은 서버 컴포넌트(`MatchRow`)가 그려 `children`으로 넘긴다 — 행 전체를 client로 만들지 않는다.
 * 패널은 펼쳤을 때만 마운트한다. 행 자체를 눌러 펼치지 않는다(행 안의 툴팁 정지점과 겹침, 10-6).
 * 변경 11: 패널 안을 "상세 기록 | AI 분석" 탭으로 나눈다. 상세 기록(`detail`)도 서버 컴포넌트가 그려 넘긴다.
 */
export default function MatchDisclosure({
  matchId,
  win,
  championName,
  feedbackEligible,
  detail,
  children,
}: {
  matchId: string;
  win: boolean;
  championName: string;
  feedbackEligible: boolean;
  /** 상세 기록 탭 내용 (서버 컴포넌트 `MatchDetail`, 변경 11) */
  detail: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const { discardError } = useFeedback();
  const borderClass = win ? "border-win" : "border-lose";
  const panelId = `match-detail-${matchId}`;

  const toggle = () => {
    // 오류는 접으면 지운다 → 다시 펼치면 ① 분석 전 (10-3). 결과·진행 중은 남는다
    if (expanded) discardError(matchId);
    setExpanded((prev) => !prev);
  };

  return (
    <div>
      {/* 모든 칸을 위쪽(items-start)으로 통일 (2026-10-27). 펼치면 아래 모서리를 각지게 해 패널과 이어 붙인다 */}
      <div
        className={`flex flex-wrap items-start gap-3 border-l-4 bg-surface p-3 ${borderClass} ${
          expanded ? "rounded-t-lg" : "rounded-lg"
        }`}
      >
        {children}
        {/* 리스트 가장 오른쪽 수직형 아코디언 토글 */}
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={expanded ? "매치 상세 정보 접기" : "매치 상세 정보 펼치기"}
          onClick={toggle}
          className={`ml-1 flex size-6 shrink-0 items-center justify-center self-center rounded-full hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent ${
            expanded ? "bg-surface-2 text-foreground" : "text-muted"
          }`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className={`size-3 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
          >
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {expanded ? (
        <div
          id={panelId}
          role="region"
          aria-label="매치 상세"
          className={`rounded-b-lg border-t border-l-4 border-t-border bg-surface/70 p-3 sm:p-4 ${borderClass}`}
        >
          <MatchDetailTabs
            detail={detail}
            ai={<FeedbackPanel matchId={matchId} championName={championName} eligible={feedbackEligible} />}
          />
        </div>
      ) : null}
    </div>
  );
}
