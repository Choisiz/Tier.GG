import { NextResponse } from "next/server";
import { getVersions_Url, getChampion_Data, getChampion_Image_Square } from "../../../lib/champions";


/* =====챔피언 이미지 리스트 반환===== */
/*
ex) GET http://localhost:3001/api/champion_images?version=15.11.1&lang=ko_KR
    version,챔피언이름,챔피언별 스퀘어 이미지
*/

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let version:string | null = searchParams.get("version");
  const language:string | null = searchParams.get("lang") || "ko_KR";

  try {
    // 버전이 없으면 최신 버전 가져오기
    if (!version) {
      const versionRes = await fetch(getVersions_Url());
      if (!versionRes.ok) throw new Error("버전 정보를 가져올 수 없습니다.");
      const versions = await versionRes.json();
      version = versions[0];
    }

    // 챔피언 데이터(이름,id,이미지주소ㄴ) 가져오기
    const champRes = await fetch(getChampion_Data(version as string, language as string));
    if (!champRes.ok) throw new Error("챔피언 데이터를 불러올 수 없습니다.");
    const champions = await champRes.json();

    type ChampionSummary = { key?: string };
    const entries = Object.entries(champions.data) as Array<[string, ChampionSummary]>;
    const championImageUrls = entries.map(([name, info]) => {
      const championId = Number(info?.key ?? 0);
      return {
        name,
        championId,
        url: getChampion_Image_Square(version as string, name),
      };
    });
    return NextResponse.json({ championImageUrls });
  } catch (e) {
    console.log("error", e);
    return NextResponse.json({ error: e }, { status: 500 });
  }
}
