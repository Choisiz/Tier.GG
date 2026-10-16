"use client";

import Image from "next/image";
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import TierBadge from "@/components/stats/TierBadge";
import type { TierListRowView } from "@/lib/view/tierList";

/** 첫 화면에 보이는 행 수 (아이콘을 바로 불러온다, D4) */
const EAGER_ROWS = 10;

/** 대소문자·공백 무시 비교용 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

type TierTableProps = {
  rows: TierListRowView[];
  /** "탑" */
  positionLabel: string;
  minTierPick: number;
};

/** 현재 포지션 안 검색 + 티어 표. 순서는 API `rank` 그대로 */
export default function TierTable({ rows, positionLabel, minTierPick }: TierTableProps) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (q === "") return rows;
    return rows.filter(
      (row) => normalize(row.name).includes(q) || (row.id !== undefined && normalize(row.id).includes(q)),
    );
  }, [rows, query]);

  return (
    <div className="space-y-3">
      <label htmlFor={inputId} className="sr-only">
        챔피언 이름 검색
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="챔피언 이름 검색 (한글/영문)"
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-base text-foreground placeholder:text-muted focus:border-accent"
      />
      <p aria-live="polite" className="text-xs text-muted">
        {filtered.length}명
      </p>

      {filtered.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">{positionLabel} 챔피언 티어 표</caption>
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th scope="col" className="w-8 px-1.5 py-2 text-right font-semibold sm:w-12 sm:px-2">
                  #
                </th>
                <th scope="col" className="px-1.5 py-2 text-left font-semibold sm:px-2">
                  챔피언
                </th>
                <th scope="col" className="w-[4.5rem] px-1.5 py-2 text-left font-semibold sm:w-[4.75rem] sm:px-2">
                  티어
                </th>
                <th scope="col" className="w-[3.25rem] px-1.5 py-2 text-right font-semibold sm:w-16 sm:px-2">
                  승률
                </th>
                <th scope="col" className="w-[3.25rem] px-1.5 py-2 text-right font-semibold sm:w-16 sm:px-2">
                  픽률
                </th>
                <th scope="col" className="hidden w-16 px-2 py-2 text-right font-semibold sm:table-cell">
                  밴률
                </th>
                <th scope="col" className="hidden w-16 px-2 py-2 text-right font-semibold sm:table-cell">
                  게임
                </th>
                <th scope="col" className="hidden w-24 px-2 py-2 text-left font-semibold md:table-cell">
                  주 포지션
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, index) => (
                <tr
                  key={row.championKey}
                  className={`relative border-t border-border ${row.id ? "hover:bg-surface-2" : ""}`}
                >
                  <td className="px-1.5 py-2 text-right text-muted tabular-nums sm:px-2">{row.rank}</td>
                  <td className="px-1.5 py-2 sm:px-2">
                    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                      <span className="relative block size-8 shrink-0 overflow-hidden rounded-md bg-surface-2">
                        {row.iconUrl ? (
                          <Image
                            src={row.iconUrl}
                            alt=""
                            fill
                            sizes="32px"
                            loading={index < EAGER_ROWS ? "eager" : "lazy"}
                            fetchPriority={index === 0 ? "high" : undefined}
                            className="object-cover"
                          />
                        ) : null}
                      </span>
                      {row.id ? (
                        <Link
                          href={`/champions/${row.id}`}
                          className="truncate font-semibold after:absolute after:inset-0 hover:text-accent"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className="truncate text-muted">{row.name}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-1.5 py-2 sm:px-2">
                    <TierBadge tier={row.tier} minTierPick={minTierPick} />
                  </td>
                  <td className="px-1.5 py-2 text-right tabular-nums sm:px-2">{row.winRate}</td>
                  <td className="px-1.5 py-2 text-right tabular-nums sm:px-2">{row.pickRate}</td>
                  <td className="hidden px-2 py-2 text-right text-muted tabular-nums sm:table-cell">
                    {row.banRate}
                  </td>
                  <td className="hidden px-2 py-2 text-right text-muted tabular-nums sm:table-cell">
                    {row.pick}
                  </td>
                  <td className="hidden px-2 py-2 text-xs text-muted md:table-cell">
                    {row.otherMainPosition ? `${row.otherMainPosition} 겸용` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface py-16 text-center">
          <p className="text-muted">&apos;{query.trim()}&apos;에 해당하는 챔피언이 없습니다</p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              // 버튼이 사라지므로 포커스를 검색창으로 돌린다 (Review 수정)
              inputRef.current?.focus();
            }}
            className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-foreground hover:opacity-90"
          >
            검색 지우기
          </button>
        </div>
      )}
    </div>
  );
}
