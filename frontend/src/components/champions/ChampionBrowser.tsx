"use client";

import { useId, useMemo, useState } from "react";
import { CHAMPION_TAGS, TAG_LABELS } from "@/lib/ddragon/transform";
import type { ChampionSummary, ChampionTag } from "@/lib/ddragon/types";
import ChampionCard from "./ChampionCard";

/** 대소문자·공백 무시 비교용 */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

export default function ChampionBrowser({
  champions,
}: {
  champions: ChampionSummary[];
}) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<ChampionTag | null>(null);
  const inputId = useId();

  const filtered = useMemo(() => {
    const q = normalize(query);
    return champions.filter((champion) => {
      const matchesQuery =
        q === "" ||
        normalize(champion.name).includes(q) ||
        normalize(champion.id).includes(q);

      const matchesTag = tag === null || champion.tags.includes(tag);
      return matchesQuery && matchesTag;
    });
  }, [champions, query, tag]);

  const resetFilters = () => {
    setQuery("");
    setTag(null);
  };

  const filterButtonClass = (active: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${
      active
        ? "border-accent bg-accent text-accent-foreground"
        : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-foreground"
    }`;

  const emptyMessage =
    query.trim() !== ""
      ? `'${query.trim()}'에 해당하는 챔피언이 없습니다`
      : "조건에 해당하는 챔피언이 없습니다";

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">
        챔피언{" "}
        <span aria-live="polite" className="text-muted">
          ({filtered.length})
        </span>
      </h1>

      <div className="space-y-3">
        <label htmlFor={inputId} className="sr-only">
          챔피언 이름 검색
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="챔피언 이름 검색 (한글/영문)"
          autoComplete="off"
          className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-base text-foreground placeholder:text-muted focus:border-accent"
        />

        <div
          role="group"
          aria-label="역할군 필터"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
        >
          <button
            type="button"
            aria-pressed={tag === null}
            onClick={() => setTag(null)}
            className={filterButtonClass(tag === null)}
          >
            전체
          </button>
          {CHAMPION_TAGS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={tag === value}
              onClick={() => setTag(tag === value ? null : value)}
              className={filterButtonClass(tag === value)}
            >
              {TAG_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length > 0 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
          {filtered.map((champion) => (
            <li key={champion.id}>
              <ChampionCard champion={champion} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-border bg-surface py-16 text-center">
          <p className="text-muted">{emptyMessage}</p>
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-foreground hover:opacity-90"
          >
            필터 초기화
          </button>
        </div>
      )}
    </div>
  );
}
