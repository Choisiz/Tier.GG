"use client";

import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type PositionTab = {
  /** "TOP" */
  key: string;
  /** "탑 · 2티어 · 90%" */
  label: string;
  /** 탭이 1개일 때 제목 ("탑") */
  title: string;
  /** 서버에서 만든 패널 내용 */
  panel: ReactNode;
};

/**
 * 상세 포지션 탭 (WAI-ARIA 탭 패턴, 변경 01 D1-b).
 * 모든 패널은 정적 HTML에 들어 있고 보이기만 바꾼다 (URL 그대로).
 * 탭이 1개면 탭 줄 없이 제목만 보인다.
 */
export default function PositionTabs({ tabs }: { tabs: PositionTab[] }) {
  const [selected, setSelected] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  if (tabs.length === 1) {
    return (
      <div className="space-y-3">
        <p className="sr-only">{tabs[0].title}</p>
        {tabs[0].panel}
      </div>
    );
  }

  const focusTab = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setSelected(next);
    tabRefs.current[next]?.focus();
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusTab(moves[event.key]);
    }
  };

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="포지션" className="flex flex-wrap gap-2">
        {tabs.map((tab, index) => {
          const active = index === selected;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.key}`}
              aria-selected={active}
              aria-controls={`${baseId}-panel-${tab.key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                active
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${baseId}-panel-${tab.key}`}
          aria-labelledby={`${baseId}-tab-${tab.key}`}
          hidden={index !== selected}
          tabIndex={0}
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
