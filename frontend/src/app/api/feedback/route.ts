import { NextResponse, type NextRequest } from "next/server";
import { postFeedback } from "@/lib/api/api";
import { isValidMatchId, pickFeedbackDetails } from "@/lib/view/feedback";
import { isValidPuuid } from "@/lib/view/laneGold";

// 비용이 드는 분석 요청을 백엔드로 넘기는 프록시다. 캐시하지 않는다 (변경 10, D72).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** 본문 상한 (계약 2-7: 2KB 이하) */
const MAX_BODY_BYTES = 2048;

function errorResponse(
  status: number,
  code: string,
  details: Record<string, unknown> | null = null,
): NextResponse {
  return NextResponse.json(
    { error: details ? { code, details } : { code } },
    { status, headers: NO_STORE },
  );
}

/** 본문 `{matchId, puuid}` 검사. 틀리면 null (400, 백엔드로 보내지 않음) */
async function readBody(request: NextRequest): Promise<{ matchId: string; puuid: string } | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return null;
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { matchId, puuid } = parsed as { matchId?: unknown; puuid?: unknown };
  if (!isValidMatchId(matchId) || typeof puuid !== "string" || !isValidPuuid(puuid)) return null;
  return { matchId, puuid };
}

/**
 * 게임 피드백 분석 프록시 (계약 2-7). POST만 받는다(GET은 Next 기본 405).
 * 브라우저는 같은 출처의 이 주소만 부르고, 백엔드 주소는 서버에만 남는다 (D6).
 * 백엔드의 `status`·`code`는 그대로, `details`는 허용한 키만 넘긴다. `puuid`는 로그에 남기지 않는다.
 */
export async function POST(request: NextRequest) {
  const body = await readBody(request);
  if (!body) {
    return errorResponse(400, "INVALID_PARAMETER");
  }

  const result = await postFeedback(body.matchId, body.puuid);
  if (result.ok) {
    return NextResponse.json(result.data, { headers: NO_STORE });
  }
  switch (result.kind) {
    case "timeout":
      return errorResponse(504, "ANALYSIS_TIMEOUT", { retryAfterSec: 15 });
    case "http":
      return errorResponse(result.status, result.code, pickFeedbackDetails(result.details));
    default:
      return errorResponse(503, "UNAVAILABLE");
  }
}
