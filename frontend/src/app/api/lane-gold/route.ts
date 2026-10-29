import { NextResponse, type NextRequest } from "next/server";
import { getLaneGold } from "@/lib/api/api";
import { isValidPuuid, parseMatchIds } from "@/lib/view/laneGold";

// 요청마다 백엔드를 부르는 프록시다. 캐시하지 않는다 (변경 08).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function errorResponse(status: number, code: string): NextResponse {
  return NextResponse.json({ error: { code } }, { status, headers: NO_STORE });
}

/**
 * 라인전 15분 골드 프록시.
 * 브라우저는 같은 출처의 이 주소만 부르고, 백엔드 주소(`API_BASE_URL`)는 서버에만 남는다 (D6, 8장).
 * 형식을 먼저 검사해 틀린 요청은 백엔드로 보내지 않는다. `puuid`는 로그에 남기지 않는다.
 */
export async function GET(request: NextRequest) {
  const puuid = request.nextUrl.searchParams.get("puuid");
  const matchIds = parseMatchIds(request.nextUrl.searchParams.get("matchIds"));
  if (!puuid || !isValidPuuid(puuid) || !matchIds) {
    return errorResponse(400, "INVALID_PARAMETER");
  }

  const result = await getLaneGold(puuid, matchIds);
  if (result.ok) {
    return NextResponse.json(result.data, { headers: NO_STORE });
  }
  switch (result.kind) {
    case "riot_unavailable":
      return errorResponse(502, "RIOT_UNAVAILABLE");
    case "riot_key_expired":
      return errorResponse(503, "RIOT_KEY_EXPIRED");
    default:
      return errorResponse(500, "UNAVAILABLE");
  }
}
