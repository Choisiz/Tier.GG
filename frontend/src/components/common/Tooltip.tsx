"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type TooltipProps = {
  /** 설명 글자(또는 span 조합). 없으면(undefined) 툴팁을 달지 않고 children만 그대로 렌더링한다 */
  content?: ReactNode;
  children: ReactNode;
  /** 화면 오른쪽 끝에 가까운 트리거는 패널을 오른쪽 정렬한다 (단순 규칙, 충돌 방지는 하지 않음) */
  align?: "left" | "right";
  /** 패널을 트리거 아래(기본)·위에 연다. 아래가 잘리는 자리(예: 히어로 하단)에서 "top" */
  placement?: "bottom" | "top";
  className?: string;
};

/**
 * 룬·스킬·소환사 주문·아이템 아이콘에 붙이는 공용 설명 툴팁.
 * 데스크톱: 마우스 호버로 열고 닫힘. 키보드: 포커스/블러로 열고 닫힘.
 * 모바일(터치): 탭하면 토글, 바깥을 탭하면 닫힘.
 * `content`가 없으면(설명 없는 항목) 트리거만 그대로 렌더링해 툴팁을 달지 않는다.
 */
export default function Tooltip({
  content,
  children,
  align = "left",
  placement = "bottom",
  className,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const ref = useRef<HTMLSpanElement>(null);
  // 모바일 탭은 포커스 이벤트(열림) 뒤에 곧바로 클릭 이벤트가 따라온다. 이 둘을 구분하지 않고
  // 클릭에서 무조건 토글하면 "포커스로 열림 → 클릭으로 다시 닫힘"이 한 탭 안에서 일어나
  // 첫 탭에서 열리지 않는다. 같은 탭에서 포커스가 막 열었는지 표시해 그 클릭은 토글하지 않는다.
  const openedByFocusRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onOutsideClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onOutsideClick);
    return () => document.removeEventListener("click", onOutsideClick);
  }, [open]);

  if (!content) {
    return <>{children}</>;
  }

  return (
    <span
      ref={ref}
      className={`relative inline-flex ${className ?? ""}`}
      tabIndex={0}
      aria-describedby={open ? panelId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => {
        openedByFocusRef.current = true;
        setOpen(true);
      }}
      onBlur={() => {
        openedByFocusRef.current = false;
        setOpen(false);
      }}
      onClick={(event) => {
        // 모바일(터치)에서는 클릭이 곧 탭이다: 토글만 하고 document 리스너로 전파되지 않게 막는다.
        event.stopPropagation();
        if (openedByFocusRef.current) {
          // 이 클릭 직전 포커스 이벤트가 같은 탭 동작으로 이미 열었다: 다시 토글해 닫지 않는다.
          openedByFocusRef.current = false;
          return;
        }
        setOpen((prev) => !prev);
      }}
    >
      {children}
      {open ? (
        <span
          id={panelId}
          role="tooltip"
          className={`absolute z-20 w-max max-w-64 rounded-md border border-border bg-surface-2 p-2 text-xs leading-relaxed text-foreground shadow-lg ${
            placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
          } ${align === "right" ? "right-0" : "left-0"}`}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
