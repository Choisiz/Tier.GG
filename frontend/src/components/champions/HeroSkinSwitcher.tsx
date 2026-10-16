"use client";

import Image from "next/image";
import { useState } from "react";
import { championSplashUrl } from "@/lib/ddragon/images";
import type { ChampionSkin } from "@/lib/ddragon/types";

/**
 * Hero 스플래시 자체를 스킨 미리보기로 쓰고, 좌우 화살표로 스킨을 순환 전환한다.
 * 이름·순서 줄은 스플래시 이미지 위 대신 배경이 고정된 정보 영역(ChampionHero)에 둬야
 * 대비를 보장할 수 있어(D14), 선택 상태가 바뀔 때마다 `onChange`로 부모에 알린다.
 */
export default function HeroSkinSwitcher({
  skins,
  championId,
  onChange,
}: {
  skins: ChampionSkin[];
  championId: string;
  onChange: (skin: ChampionSkin, index: number) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = skins[selectedIndex] ?? skins[0];
  if (!selected) {
    return null;
  }

  const go = (nextIndex: number) => {
    const normalized = (nextIndex + skins.length) % skins.length;
    setSelectedIndex(normalized);
    onChange(skins[normalized], normalized);
  };

  return (
    <>
      <Image
        src={championSplashUrl(championId, selected.num)}
        alt=""
        fill
        fetchPriority="high"
        loading="eager"
        sizes="(min-width: 1152px) 1152px, 100vw"
        className="object-cover object-top"
      />
      {skins.length > 1 ? (
        <>
          <button
            type="button"
            aria-label="이전 스킨"
            onClick={() => go(selectedIndex - 1)}
            className="absolute top-1/2 left-2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/60 text-xl font-bold text-foreground hover:bg-background/80 focus-visible:outline-none"
          >
            <span aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            aria-label="다음 스킨"
            onClick={() => go(selectedIndex + 1)}
            className="absolute top-1/2 right-2 z-10 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/60 text-xl font-bold text-foreground hover:bg-background/80 focus-visible:outline-none"
          >
            <span aria-hidden="true">›</span>
          </button>
        </>
      ) : null}
    </>
  );
}
