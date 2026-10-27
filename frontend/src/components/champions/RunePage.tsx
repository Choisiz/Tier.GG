"use client";

import Image from "next/image";
import { useState } from "react";
import Tooltip from "@/components/common/Tooltip";
import type {
  RuneCellView,
  RunePageView,
  RuneTreeView,
} from "@/lib/view/builds";

/** 룬 칸 1개. 고른 룬만 alt를 갖고, 나머지는 장식(흐리게). 설명이 있으면 호버·포커스·탭 툴팁 */
function RuneIcon({ cell, size }: { cell: RuneCellView; size: "lg" | "md" }) {
  const box = size === "lg" ? "size-9 sm:size-10" : "size-7 sm:size-8";
  const px = size === "lg" ? "40px" : "32px";
  const tone = cell.selected ? "ring-2 ring-accent" : "opacity-35 grayscale";

  if (!cell.iconUrl) {
    return (
      <Tooltip content={cell.description}>
        <span
          className={`relative flex ${box} shrink-0 items-center justify-center rounded-full bg-surface-2 text-[10px] text-muted ${tone}`}
          title={cell.name}
          aria-hidden={cell.selected ? undefined : true}
        >
          ?{cell.selected ? <span className="sr-only">{cell.name}</span> : null}
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={cell.description}>
      <span
        className={`relative block ${box} shrink-0 overflow-hidden rounded-full bg-background ${tone}`}
        aria-hidden={cell.selected ? undefined : true}
      >
        <Image
          src={cell.iconUrl}
          alt={cell.selected ? cell.name : ""}
          title={cell.name}
          fill
          sizes={px}
          className="object-contain p-0.5"
        />
      </span>
    </Tooltip>
  );
}

function RuneTree({
  tree,
  keystone,
}: {
  tree: RuneTreeView;
  keystone: boolean;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <ul className="space-y-2">
        {tree.rows.map((row, rowIndex) => (
          <li key={rowIndex} className="flex gap-2">
            {row.map((cell) => (
              <RuneIcon
                key={cell.id}
                cell={cell}
                size={keystone && rowIndex === 0 ? "lg" : "md"}
              />
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 추천 룬 전체 페이지 + 1순위/2순위 전환. op.gg 스타일로 핵심 → 보조 → 능력치 파편 순 세로 배치 */
export default function RunePage({ pages }: { pages: RunePageView[] }) {
  const [selected, setSelected] = useState(0);
  const page = pages[selected] ?? pages[0];

  return (
    <div className="space-y-4">
      {pages.length > 1 ? (
        <div className="flex gap-2">
          {pages.map((item, index) => (
            <button
              key={index}
              type="button"
              aria-pressed={index === selected}
              onClick={() => setSelected(index)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-center text-xs transition-colors ${
                index === selected
                  ? "border-accent bg-surface-2 text-foreground"
                  : "border-border text-muted hover:bg-surface-2"
              }`}
            >
              <span className="flex shrink-0 items-center gap-1">
                {[item.primary, item.secondary].map((tree, treeIndex) =>
                  tree.iconUrl ? (
                    <Image
                      key={treeIndex}
                      src={tree.iconUrl}
                      alt=""
                      width={28}
                      height={28}
                      className="size-7"
                    />
                  ) : null,
                )}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{index + 1}순위</span>
                <span className="mt-1 flex justify-center gap-3">
                  {[
                    ["사용", item.pickRate],
                    ["승률", item.winRate],
                    ["게임", item.pick],
                  ].map(([label, value]) => (
                    <span key={label} className="block">
                      <span className="block text-[11px] text-muted">
                        {label}
                      </span>
                      <span className="block font-medium text-foreground">
                        {value}
                      </span>
                    </span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <p className="sr-only">{page.summary}</p>

      <div className="space-y-4 lg:grid lg:grid-cols-[2fr_1.5fr_1fr] lg:items-start lg:gap-3 lg:space-y-0">
        <div className="space-y-2">
          <RuneTree tree={page.primary} keystone />
        </div>
        <div className="lg:mt-12">
          <RuneTree tree={page.secondary} keystone={false} />
        </div>
        <div className="space-y-2 lg:mt-5">
          <p className="text-sm font-semibold">능력치 파편</p>
          <ul className="space-y-2">
            {page.shards.map((row) => (
              <li key={row.label} className="flex items-center gap-2">
                <span className="w-7 text-xs text-muted">{row.label}</span>
                {row.cells.map((cell, index) => (
                  <RuneIcon key={`${cell.id}-${index}`} cell={cell} size="md" />
                ))}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
