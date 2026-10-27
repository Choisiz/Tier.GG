"use client";

import { useState } from "react";

/**
 * 매치 행 오른쪽 끝의 수직형 아코디언 토글. 2026-10-27 추가.
 * 지금은 펼침 상태(화살표 회전)만 토글하고, 펼쳤을 때 보여줄 상세 데이터는 아직 없다(다음 변경에서 추가).
 * 행 전체를 client로 만들지 않으려고 이 버튼만 작은 client 컴포넌트로 분리했다.
 */
export default function MatchExpandToggle() {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={expanded ? "매치 상세 정보 접기" : "매치 상세 정보 펼치기"}
      onClick={() => setExpanded((prev) => !prev)}
      className="ml-1 flex size-6 shrink-0 items-center justify-center self-center rounded-full text-muted hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
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
  );
}
