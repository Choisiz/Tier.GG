"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FEEDBACK_BROWSER_TIMEOUT_MS,
  feedbackErrorView,
  isFeedbackResponse,
  toFeedbackView,
  type FeedbackErrorView,
  type FeedbackView,
} from "@/lib/view/feedback";

/**
 * 한 판의 분석 상태 (10-3).
 * - `loading`: 요청 중. `startedAt`으로 경과 초를 센다
 * - `done`: 결과. 페이지가 살아 있는 동안 유지(다시 펼쳐도 재요청 없음)
 * - `error`: 오류. 패널을 접으면 지운다. `at`은 [다시 시도] 대기 초를 셀 때 쓴다
 */
export type FeedbackEntry =
  | { kind: "loading"; startedAt: number }
  | { kind: "done"; view: FeedbackView }
  | { kind: "error"; view: FeedbackErrorView; at: number };

type FeedbackContextValue = {
  entries: Record<string, FeedbackEntry>;
  /** 429 daily를 한 번 받으면 목록 전체 분석 버튼 비활성 (새로 고침하면 풀림) */
  limitReached: boolean;
  start: (matchId: string) => void;
  discardError: (matchId: string) => void;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function useFeedback(): FeedbackContextValue {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("useFeedback은 FeedbackProvider 안에서만 쓸 수 있습니다.");
  return value;
}

/** 같은 출처 프록시 1회 호출 → 저장할 항목. 자동 재시도 없음 */
async function requestFeedback(
  matchId: string,
  puuid: string,
  signal: AbortSignal,
  timedOut: () => boolean,
): Promise<FeedbackEntry> {
  let response: Response;
  try {
    response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId, puuid }),
      cache: "no-store",
      signal,
    });
  } catch {
    const view = timedOut()
      ? feedbackErrorView(504, "ANALYSIS_TIMEOUT", { retryAfterSec: 15 })
      : feedbackErrorView(503, "UNAVAILABLE", null);
    return { kind: "error", view, at: Date.now() };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 아래에서 모양 이상으로 처리
  }

  if (response.ok) {
    if (isFeedbackResponse(body)) return { kind: "done", view: toFeedbackView(body) };
    console.error("[feedback] 응답 모양이 계약과 다릅니다.");
    return { kind: "error", view: feedbackErrorView(500, null, null), at: Date.now() };
  }

  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error: { code?: unknown; details?: unknown } }).error
      : null;
  const code = typeof error?.code === "string" ? error.code : null;
  const details =
    typeof error?.details === "object" && error.details !== null
      ? (error.details as Record<string, unknown>)
      : null;
  if (response.status === 400) {
    // 400은 프론트 버그다. 사용자 문구는 "지금은 분석할 수 없어요"로 통일 (D77)
    console.error(`[feedback] 잘못된 요청 → HTTP 400 ${code ?? "-"}`);
  }
  return { kind: "error", view: feedbackErrorView(response.status, code, details), at: Date.now() };
}

/**
 * 매치 목록 하나의 AI 분석 결과·진행 상태 (변경 10, D73). `MatchList`가 `key={puuid}`로 감싼다.
 * 패널이 접혀(언마운트) 있어도 진행 중 요청과 결과가 남는다. 결과는 브라우저 저장소에 남기지 않는다(D78).
 */
export default function FeedbackProvider({
  puuid,
  children,
}: {
  puuid: string;
  children: ReactNode;
}) {
  const [entries, setEntries] = useState<Record<string, FeedbackEntry>>({});
  const [limitReached, setLimitReached] = useState(false);
  // 연타·동시 클릭 중복 방지: state보다 먼저 바뀌는 진행 중 목록
  const inflight = useRef(new Set<string>());
  const doneIds = useRef(new Set<string>());
  const controllers = useRef(new Set<AbortController>());
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    const active = controllers.current;
    return () => {
      // 다른 소환사로 바뀌거나 페이지를 떠나면 진행 중 요청을 버린다 (언마운트 뒤 상태 변경 없음)
      alive.current = false;
      active.forEach((controller) => controller.abort());
      active.clear();
    };
  }, []);

  const start = useCallback(
    (matchId: string) => {
      if (inflight.current.has(matchId) || doneIds.current.has(matchId)) return;
      inflight.current.add(matchId);
      setEntries((prev) => ({ ...prev, [matchId]: { kind: "loading", startedAt: Date.now() } }));

      const controller = new AbortController();
      controllers.current.add(controller);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, FEEDBACK_BROWSER_TIMEOUT_MS);

      void requestFeedback(matchId, puuid, controller.signal, () => timedOut).then((entry) => {
        clearTimeout(timer);
        controllers.current.delete(controller);
        inflight.current.delete(matchId);
        if (!alive.current) return;
        if (entry.kind === "done") doneIds.current.add(matchId);
        if (entry.kind === "error" && entry.view.limitReached) setLimitReached(true);
        setEntries((prev) => ({ ...prev, [matchId]: entry }));
      });
    },
    [puuid],
  );

  const discardError = useCallback((matchId: string) => {
    setEntries((prev) => {
      if (prev[matchId]?.kind !== "error") return prev;
      const next = { ...prev };
      delete next[matchId];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ entries, limitReached, start, discardError }),
    [entries, limitReached, start, discardError],
  );

  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}
