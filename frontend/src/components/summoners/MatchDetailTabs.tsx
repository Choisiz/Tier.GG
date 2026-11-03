"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const TABS = [
  { key: "detail", label: "상세 기록" },
  { key: "ai", label: "AI 분석" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * 펼친 칸의 "상세 기록 | AI 분석" 탭 (변경 11). WAI-ARIA tablist: 좌우 화살표·Home·End로 이동,
 * 이동과 동시에 선택(자동 활성화). 두 패널은 모두 마운트한 채 `hidden`으로만 숨겨,
 * 탭을 바꿔도 AI 분석 진행 상태·결과가 유지된다.
 */
export default function MatchDetailTabs({ detail, ai }: { detail: ReactNode; ai: ReactNode }) {
  const [active, setActive] = useState<TabKey>("detail");
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number) => {
    const next = (index + TABS.length) % TABS.length;
    setActive(TABS[next].key);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = TABS.findIndex((tab) => tab.key === active);
    if (event.key === "ArrowRight") select(current + 1);
    else if (event.key === "ArrowLeft") select(current - 1);
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(TABS.length - 1);
    else return;
    event.preventDefault();
  };

  const panels: Record<TabKey, ReactNode> = { detail, ai };

  return (
    <div>
      <div
        role="tablist"
        aria-label="매치 상세 보기"
        onKeyDown={onKeyDown}
        className="mb-3 flex gap-1 border-b border-border"
      >
        {TABS.map((tab, index) => {
          const selected = tab.key === active;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent ${
                selected
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${baseId}-panel-${tab.key}`}
          aria-labelledby={`${baseId}-tab-${tab.key}`}
          hidden={tab.key !== active}
        >
          {panels[tab.key]}
        </div>
      ))}
    </div>
  );
}
