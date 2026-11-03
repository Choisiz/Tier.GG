/**
 * 게임 피드백 분석(변경 10, 계약 2-7) 순수 함수 모음.
 * React·Next·서버 전용 모듈을 가져오지 않는다(서버 Route Handler·서버 뷰·클라이언트 컴포넌트가 함께 쓴다).
 * 등급·점수·영역 판정어는 만들지 않는다(D75). 응답에 모르는 필드(예: `grade`)가 있어도 쓰지 않는다.
 */
import type { FeedbackResponse, FeedbackRole } from "@/lib/api/types";

/** 분석하는 큐: 솔로랭크·자유랭크 (계약 2-7) */
const FEEDBACK_QUEUE_IDS = new Set([420, 440]);
/** 분석하는 최소 게임 시간(초) */
export const FEEDBACK_MIN_DURATION_SEC = 900;
/** 브라우저 → `/api/feedback` 대기 상한(ms). 백엔드 30초 < 프록시 35초 < 브라우저 40초 (D76) */
export const FEEDBACK_BROWSER_TIMEOUT_MS = 40_000;
/** `retryAfterSec`가 없거나 범위(1~60) 밖일 때 */
export const FEEDBACK_DEFAULT_RETRY_SEC = 15;
/** 결정적 장면 최대 개수 (계약 2-7: 0~3개) */
export const FEEDBACK_MAX_KEY_MOMENTS = 3;

const MATCH_ID_PATTERN = /^KR_[0-9]{1,15}$/;

export function isValidMatchId(value: unknown): value is string {
  return typeof value === "string" && MATCH_ID_PATTERN.test(value);
}

/** 버튼을 보여 줄 판인지 (계약 2-7 프론트 권장: 420·440이고 900초 이상) */
export function isFeedbackEligible(queueId: number, gameDurationSec: number): boolean {
  return FEEDBACK_QUEUE_IDS.has(queueId) && gameDurationSec >= FEEDBACK_MIN_DURATION_SEC;
}

/** 엔진 유형 → 한글 이름 (백엔드 role.ts와 같은 이름) */
export const ROLE_LABEL_KO: Record<FeedbackRole, string> = {
  TOP_TANK: "탱탑",
  TOP_DAMAGE: "딜탑",
  JUNGLE_TANK: "탱정글",
  JUNGLE_DAMAGE: "딜정글",
  MID_TANK: "탱미드",
  MID_DAMAGE: "딜미드",
  ADC: "원딜",
  SUPPORT_TANK: "탱서폿",
  SUPPORT_DAMAGE: "딜서폿",
  SUPPORT_UTILITY: "유틸서폿",
};

/** 게임 시간(초) → `m:ss` (906 → "15:06") */
export function formatGameTime(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/* ───────── 응답 → 화면 모양 ───────── */

export type FeedbackSectionKey = "laning" | "fight" | "macro";

export type FeedbackSectionView = {
  key: FeedbackSectionKey;
  label: string;
  /** 영역 설명 (라인전은 없음) */
  hint: string | null;
  good: string[];
  bad: string[];
  note: string | null;
};

export type FeedbackMomentView = {
  time: string;
  direction: "widened" | "narrowed";
  text: string;
};

export type FeedbackView = {
  /** 유형 한글 이름. 모르는 값이면 null (머리말에서 유형만 뺀다) */
  roleLabel: string | null;
  templateReason: "llm_off" | "llm_error" | null;
  summary: string;
  sections: FeedbackSectionView[];
  moments: FeedbackMomentView[];
};

const SECTION_META: { key: FeedbackSectionKey; label: string; hint: string | null }[] = [
  { key: "laning", label: "라인전", hint: null },
  { key: "fight", label: "교전", hint: "오브젝트 싸움" },
  { key: "macro", label: "운영", hint: "그 밖의 싸움·시야·파밍" },
];

/** 응답 → 화면 모양. 섹션 순서 고정, 결정적 장면 최대 3개, 등급류 필드는 읽지 않는다 */
export function toFeedbackView(response: FeedbackResponse): FeedbackView {
  return {
    roleLabel: ROLE_LABEL_KO[response.role] ?? null,
    templateReason: response.mode === "template" ? (response.templateReason ?? "llm_error") : null,
    summary: response.summary.text,
    sections: SECTION_META.map(({ key, label, hint }) => {
      const section = response.sections[key];
      return {
        key,
        label,
        hint,
        good: section.good.map((item) => item.text),
        bad: section.bad.map((item) => item.text),
        note: section.note,
      };
    }),
    moments: response.keyMoments.slice(0, FEEDBACK_MAX_KEY_MOMENTS).map((moment) => ({
      time: formatGameTime(moment.startSec),
      direction: moment.direction,
      text: moment.text,
    })),
  };
}

/* ───────── 응답 모양 검사 ───────── */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isItemList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isObject(item) && typeof item.text === "string");
}

function isSection(value: unknown): boolean {
  return (
    isObject(value) &&
    isItemList(value.good) &&
    isItemList(value.bad) &&
    (value.note === null || value.note === undefined || typeof value.note === "string")
  );
}

/** 200 본문이 계약 2-7 모양인지 (화면에 필요한 필드만 본다) */
export function isFeedbackResponse(body: unknown): body is FeedbackResponse {
  if (!isObject(body)) return false;
  if (typeof body.matchId !== "string" || typeof body.role !== "string") return false;
  if (body.mode !== "llm" && body.mode !== "template") return false;
  if (!isObject(body.summary) || typeof body.summary.text !== "string") return false;
  const sections = body.sections;
  if (!isObject(sections)) return false;
  if (!isSection(sections.laning) || !isSection(sections.fight) || !isSection(sections.macro)) {
    return false;
  }
  return (
    Array.isArray(body.keyMoments) &&
    body.keyMoments.every(
      (moment) =>
        isObject(moment) &&
        typeof moment.startSec === "number" &&
        (moment.direction === "widened" || moment.direction === "narrowed") &&
        typeof moment.text === "string",
    )
  );
}

/* ───────── 오류 → 화면 문구 (10-5) ───────── */

export type FeedbackErrorAction = "retry" | "research" | "none" | "disabled";

export type FeedbackErrorView = {
  text: string;
  action: FeedbackErrorAction;
  /** `info`는 회색 안내(분석 불가 판), `warn`은 경고 */
  tone: "info" | "warn";
  /** [다시 시도]를 이 초만큼 비활성 (503 busy·504) */
  retryAfterSec: number | null;
  /** 429 daily: 목록 전체 분석 버튼 비활성 */
  limitReached: boolean;
};

export const FEEDBACK_LIMIT_TEXT = "오늘 분석 한도를 모두 썼어요. 자정(한국 시간)에 다시 열려요.";
const GENERIC_TEXT = "지금은 분석할 수 없어요. 잠시 후 다시 시도해 주세요.";

function clampRetrySec(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 60
    ? Math.ceil(value)
    : FEEDBACK_DEFAULT_RETRY_SEC;
}

function view(
  text: string,
  action: FeedbackErrorAction,
  extra: Partial<Pick<FeedbackErrorView, "tone" | "retryAfterSec" | "limitReached">> = {},
): FeedbackErrorView {
  return { text, action, tone: "warn", retryAfterSec: null, limitReached: false, ...extra };
}

/**
 * HTTP 상태 + `code`(+ `details.reason`) → 화면 문구와 버튼. 분기는 `code`로만 한다(계약 3장).
 * 브라우저 40초 초과는 `(504, "ANALYSIS_TIMEOUT", {retryAfterSec: 15})`로 넘긴다.
 */
export function feedbackErrorView(
  status: number,
  code: string | null,
  details: Record<string, unknown> | null,
): FeedbackErrorView {
  const reason = details && typeof details.reason === "string" ? details.reason : null;

  if (status === 429 && code === "ANALYSIS_LIMIT_REACHED") {
    return reason === "budget"
      ? view("지금은 분석을 쓸 수 없어요.", "none")
      : view(FEEDBACK_LIMIT_TEXT, "disabled", { limitReached: true });
  }
  if (status === 422 && code === "ANALYSIS_UNSUPPORTED") {
    return reason === "no_position" || reason === "no_timeline"
      ? view("이 경기는 분석에 필요한 기록이 없어요.", "none", { tone: "info" })
      : view("솔로·자유랭크 15분 이상 경기만 분석할 수 있어요.", "none", { tone: "info" });
  }
  if (status === 404 && code === "MATCH_NOT_FOUND") {
    return reason === "participant"
      ? view("검색 결과가 오래됐어요. 다시 검색해 주세요.", "research")
      : view("경기 정보를 찾을 수 없어요.", "none");
  }
  if ((status === 503 && code === "ANALYSIS_BUSY") || (status === 504 && code === "ANALYSIS_TIMEOUT")) {
    const sec = clampRetrySec(details?.retryAfterSec);
    return view(`분석이 조금 오래 걸리고 있어요. ${sec}초 뒤 다시 눌러 주세요.`, "retry", {
      retryAfterSec: sec,
    });
  }
  if (status === 502 && code === "RIOT_UNAVAILABLE") {
    return view("Riot 서버가 바빠요. 잠시 후 다시 눌러 주세요.", "retry");
  }
  if (status === 503 && code === "ANALYSIS_DISABLED") {
    return view("AI 분석은 준비 중이에요.", "disabled");
  }
  return view(GENERIC_TEXT, "retry");
}

/** 프록시가 화면으로 넘겨도 되는 `details` 키 (10-4) */
const ALLOWED_DETAIL_KEYS = ["reason", "retryAfterSec", "resetAt", "limit"] as const;

/** 백엔드 `details`에서 허용한 키만 복사한다. 남는 키가 없으면 null */
export function pickFeedbackDetails(
  details: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!details) return null;
  const picked: Record<string, unknown> = {};
  for (const key of ALLOWED_DETAIL_KEYS) {
    const value = details[key];
    if (typeof value === "string" || typeof value === "number") picked[key] = value;
  }
  return Object.keys(picked).length > 0 ? picked : null;
}
