import Link from "next/link";
import { POSITION_LABELS, POSITIONS, tierListHref } from "@/lib/api/positions";
import type { Position } from "@/lib/api/types";

/** 리스트 포지션 탭 (페이지 이동 링크). 현재 탭은 aria-current="page" */
export default function PositionNav({ current }: { current: Position }) {
  return (
    <nav aria-label="포지션" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex gap-2">
        {POSITIONS.map((position) => {
          const active = position === current;
          return (
            <li key={position} className="shrink-0">
              <Link
                href={tierListHref(position)}
                aria-current={active ? "page" : undefined}
                className={`inline-block rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {POSITION_LABELS[position]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
