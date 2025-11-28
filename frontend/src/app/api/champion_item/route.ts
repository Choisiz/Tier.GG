import { NextResponse } from "next/server";
import { getLatestVersion } from "../../../lib/champions";
import { getItem_Image } from "../../../lib/itemAssets";
import { fetchRunes } from "../../../lib/runes";

type ChampionTierEntry = {
  championId: number;
  position: string;
  tier: string;
  pickCount: number;
  winCount: number;
  pickRate: number;
  winRate: number;
  banRate: number;
  score: number;
  items?: number[];
  primaryRunes?: number[];
  subRunes?: number[];
};

const runeCache = new Map<string, Map<number, string>>();
const RUNE_PRIORITY_ORDER = [
  8112, 8128, 9923, 8351, 8360, 8369, 8005, 8008, 8021, 8437, 8439, 8465, 8214,
  8229, 8230,
];
const RUNE_PRIORITY_MAP = new Map(
  RUNE_PRIORITY_ORDER.map((id, idx) => [id, idx])
);

async function getRuneIconMap(
  version: string,
  language = "ko_KR"
): Promise<Map<number, string>> {
  const cacheKey = `${version}_${language}`;
  const cached = runeCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const data = await fetchRunes(version, language);
  const map = new Map<number, string>();
  data.forEach((tree) => {
    tree.slots?.forEach((slot) => {
      slot.runes?.forEach((rune) => {
        if (typeof rune?.id === "number" && typeof rune?.icon === "string") {
          const iconUrl = `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`;
          map.set(rune.id, iconUrl);
        }
      });
    });
  });
  runeCache.set(cacheKey, map);
  return map;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const championId = searchParams.get("championId");
  if (!championId) {
    return NextResponse.json(
      { ok: false, error: "championId is required" },
      { status: 400 }
    );
  }

  try {
    const backendUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:5500";
    const version = await getLatestVersion();
    const tierResponse = await fetch(
      `${backendUrl}/info/champion/tierList`,
      { cache: "no-store" }
    );
    if (!tierResponse.ok) {
      throw new Error("백엔드 챔피언 데이터 조회 실패");
    }
    const tierData = await tierResponse.json();
    if (!tierData?.data || !Array.isArray(tierData.data)) {
      throw new Error("챔피언 데이터 형식이 올바르지 않습니다.");
    }

    const runeIcons = await getRuneIconMap(version);
    const champIdNumber = Number(championId);
    const tierEntries = tierData.data as ChampionTierEntry[];
    const filtered = tierEntries.filter(
      (entry) => entry.championId === champIdNumber
    );

    if (!filtered.length) {
      return NextResponse.json(
        { ok: false, error: "champion data not found" },
        { status: 404 }
      );
    }

    const mapRunes = (list?: number[]) => {
      if (!Array.isArray(list)) return [];
      const mapped = list
        .filter((id) => typeof id === "number" && id > 0)
        .map((id) => ({
          id,
          image: runeIcons.get(id) ?? null,
        }));
      mapped.sort((a, b) => {
        const pa = RUNE_PRIORITY_MAP.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const pb = RUNE_PRIORITY_MAP.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return pa - pb;
      });
      return mapped;
    };

    const positions = filtered.map((entry) => {
      const items: Array<{ id: number; image: string }> = Array.isArray(
        entry.items
      )
        ? entry.items
            .filter((id: number) => typeof id === "number" && id > 0)
            .map((id: number) => ({
              id,
              image: getItem_Image(version, id),
            }))
        : [];

      return {
        position: entry.position,
        tier: entry.tier,
        pickCount: entry.pickCount,
        winCount: entry.winCount,
        pickRate: entry.pickRate,
        winRate: entry.winRate,
        banRate: entry.banRate,
        score: entry.score,
        items,
        runes: {
          primary: mapRunes(entry.primaryRunes),
          sub: mapRunes(entry.subRunes),
        },
      };
    });

    return NextResponse.json({
      ok: true,
      statDate: tierData.statDate,
      championId: champIdNumber,
      version,
      positions,
    });
  } catch (error) {
    console.error("champion_item API error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "failed to fetch champion item data",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

