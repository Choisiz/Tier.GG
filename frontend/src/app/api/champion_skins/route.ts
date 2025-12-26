// app/api/champion_skins/route.ts
import { getVersions_Url, getChampionData_Detail_Url } from "@/lib/champions";
import { NextRequest, NextResponse } from "next/server";

// Data Dragon에서 받아오는 원본 스킨 타입
interface RawChampionSkin {
  id: string;
  num: number;
  name: string;
  chromas?: boolean;
}

// Data Dragon에서 받아오는 원본 챔피언 타입
interface RawChampionData {
  id: string;
  key: string;
  name: string;
  title: string;
  skins: RawChampionSkin[];
}

interface ChampionSkinData {
  id: string;
  num: number;
  name: string;
  splashUrl: string;
  loadingUrl: string;
  chromas?: boolean;
}

interface ChampionSkinsResponse {
  championId: string;
  championName: string;
  skins: ChampionSkinData[];
}

//GET http://localhost:3001/api/champion_skins?championName=Ahri&version=15.11.1&language=ko_KR
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const championName = searchParams.get("championName");
    let version = searchParams.get("version");
    const lang = searchParams.get("lang") || "ko_KR";

    if (!championName) {
      return NextResponse.json(
        { error: "championId 파라미터가 필요합니다." },
        { status: 400 }
      );
    }

    // 버전이 없으면 최신 버전 가져오기
    if (!version) {
      const versionRes = await fetch(getVersions_Url());
      if (!versionRes.ok) throw new Error("버전 정보를 가져올 수 없습니다.");
      const versions = await versionRes.json();
      version = versions[0];
    }

    // Data Dragon에서 특정 챔피언 데이터 가져오기
    const detailRes = await fetch(getChampionData_Detail_Url(version, lang, championName));
    if (!detailRes.ok) throw new Error("챔피언 데이터를 불러올 수 없습니다.");
    const championData = await detailRes.json();
    const champion: RawChampionData = championData.data[championName];

    if (!champion) {
      return NextResponse.json(
        { error: "챔피언 데이터를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 스킨 데이터 변환
    const skins: ChampionSkinData[] = champion.skins.map(
      (skin: RawChampionSkin) => ({
        id: skin.id,
        num: skin.num,
        name: skin.name === "default" ? `기본 ${champion.name}` : skin.name,
        splashUrl: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championName}_${skin.num}.jpg`,
        loadingUrl: `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championName}_${skin.num}.jpg`,
        chromas: skin.chromas,
      })
    );

    const result: ChampionSkinsResponse = {
      championId: championName,
      championName: champion.name,
      skins: skins,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Champion skins API 에러:", error);
    return NextResponse.json(
      { error: "서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
