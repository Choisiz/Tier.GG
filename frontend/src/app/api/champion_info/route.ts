import { NextResponse } from "next/server";
import { getVersions_Url, getChampionData_Detail_Url } from "../../../lib/champions";

//GET http://localhost:3000/api/champion_info?version=15.11.1&lang=ko_KR&name=Ahri
// 챔피언 개별정보(스킨,패시브정보,스킬정보,기본능력치,이미지정보,태그(포지션)등)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  let version = searchParams.get("version");
  const language = searchParams.get("lang") || "ko_KR";
  const name = searchParams.get("name") || "Ahri";

  try {
    // 버전이 없으면 최신 버전 가져오기
    if (!version) {
      const versionRes = await fetch(getVersions_Url());
      if (!versionRes.ok) throw new Error("버전 정보를 가져올 수 없습니다.");
      const versions = await versionRes.json();
      version = versions[0];
    }

    // 챔피언 상세 데이터 가져오기
    const detailRes = await fetch(getChampionData_Detail_Url(version, language, name));
    if (!detailRes.ok) throw new Error("챔피언 데이터를 불러올 수 없습니다.");
    const ChampionData_Detail = await detailRes.json();

    console.log("cc", ChampionData_Detail);
    return NextResponse.json(ChampionData_Detail);
  } catch (e) {
    console.log("error", e);
    return NextResponse.json({ error: e }, { status: 500 });
  }
}
