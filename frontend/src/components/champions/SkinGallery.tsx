"use client";

import Image from "next/image";
import { useState } from "react";
import type { ChampionSkin } from "@/lib/ddragon/types";

/** 이미지 로드 실패 시 보여줄 회색 플레이스홀더 (부모가 고정 비율) */
function ImagePlaceholder({ label }: { label: string }) {
  return (
    <span className="absolute inset-0 flex items-center justify-center bg-surface-2 p-2 text-center text-xs text-muted">
      {label}
    </span>
  );
}

export default function SkinGallery({ skins }: { skins: ChampionSkin[] }) {
  const [selectedNum, setSelectedNum] = useState<number>(skins[0]?.num ?? 0);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());

  const markFailed = (url: string) =>
    setFailed((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));

  const selected = skins.find((skin) => skin.num === selectedNum) ?? skins[0];

  if (!selected) {
    return null;
  }

  return (
    <section aria-labelledby="skins-heading" className="space-y-4">
      <h2 id="skins-heading" className="text-xl font-bold">
        스킨 <span className="text-muted">({skins.length})</span>
      </h2>

      <figure className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="relative aspect-video w-full bg-surface-2">
          {failed.has(selected.splashUrl) ? (
            <ImagePlaceholder label="이미지를 불러오지 못했습니다" />
          ) : (
            <Image
              key={selected.splashUrl}
              src={selected.splashUrl}
              alt={selected.name}
              fill
              sizes="(min-width: 1152px) 1152px, 100vw"
              className="object-cover"
              onError={() => markFailed(selected.splashUrl)}
            />
          )}
        </div>
        <figcaption
          aria-live="polite"
          className="px-4 py-3 text-lg font-semibold"
        >
          {selected.name}
        </figcaption>
      </figure>

      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {skins.map((skin) => {
          const isSelected = skin.num === selected.num;
          return (
            <li key={skin.num}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={skin.name}
                onClick={() => setSelectedNum(skin.num)}
                className={`group flex w-full flex-col gap-1.5 rounded-lg p-1 text-left transition-colors ${
                  isSelected ? "bg-surface-2" : "hover:bg-surface"
                }`}
              >
                <span
                  className={`relative block aspect-[308/560] w-full overflow-hidden rounded-md bg-surface-2 ${
                    isSelected
                      ? "ring-2 ring-accent"
                      : "ring-1 ring-border group-hover:ring-muted"
                  }`}
                >
                  {failed.has(skin.loadingUrl) ? (
                    <ImagePlaceholder label={skin.name} />
                  ) : (
                    <Image
                      src={skin.loadingUrl}
                      alt={skin.name}
                      fill
                      sizes="(min-width: 1024px) 180px, (min-width: 768px) 20vw, (min-width: 640px) 25vw, 33vw"
                      className="object-cover"
                      onError={() => markFailed(skin.loadingUrl)}
                    />
                  )}
                </span>
                <span
                  className={`line-clamp-2 text-xs sm:text-sm ${
                    isSelected
                      ? "font-semibold text-accent"
                      : "text-foreground/90"
                  }`}
                >
                  {skin.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
