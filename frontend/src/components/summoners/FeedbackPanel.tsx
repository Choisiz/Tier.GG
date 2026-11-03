"use client";

import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";
import { FEEDBACK_LIMIT_TEXT, type FeedbackErrorView } from "@/lib/view/feedback";
import { useFeedback, type FeedbackEntry } from "./FeedbackProvider";
import FeedbackResult, { FeedbackHeading, InfoIcon, SparkIcon, WarnIcon } from "./FeedbackResult";

/** `active`인 동안 1초마다 바뀌는 현재 시각 (경과 초·대기 초 표시용) */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0 animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".3" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const PRIMARY_BUTTON =
  "inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-bold sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const SECONDARY_BUTTON =
  "inline-flex w-full shrink-0 items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-bold hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function DisabledAnalyzeButton() {
  return (
    <button type="button" disabled className={`${PRIMARY_BUTTON} cursor-not-allowed bg-surface-2 text-muted`}>
      <SparkIcon />
      AI 분석하기
    </button>
  );
}

/** ⑤ 오류: 한 줄 안내(`alert`) + 필요할 때만 버튼 (10-5) */
function ErrorBox({
  view,
  at,
  onRetry,
  onResearch,
  boxRef,
}: {
  view: FeedbackErrorView;
  at: number;
  onRetry: () => void;
  onResearch: () => void;
  boxRef?: Ref<HTMLDivElement>;
}) {
  const waitUntil = view.retryAfterSec ? at + view.retryAfterSec * 1000 : 0;
  const now = useNow(waitUntil > 0);
  const remaining = waitUntil > now ? Math.ceil((waitUntil - now) / 1000) : 0;

  let button = null;
  if (view.action === "retry") {
    button = (
      <button type="button" onClick={onRetry} disabled={remaining > 0} className={SECONDARY_BUTTON}>
        다시 시도
        {remaining > 0 ? (
          <span className="ml-1 text-[11px] font-normal text-muted tabular-nums">({remaining}초 뒤 활성)</span>
        ) : null}
      </button>
    );
  } else if (view.action === "research") {
    button = (
      <button type="button" onClick={onResearch} className={SECONDARY_BUTTON}>
        다시 검색
      </button>
    );
  } else if (view.action === "disabled") {
    button = <DisabledAnalyzeButton />;
  }

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      role="alert"
      className="mt-3 flex flex-col items-stretch gap-3 rounded-lg border border-border bg-surface p-3 focus:outline-none sm:flex-row sm:items-center"
    >
      <p className={`flex flex-1 gap-1.5 text-sm ${view.tone === "info" ? "text-muted" : "text-accent"}`}>
        {view.tone === "info" ? <InfoIcon /> : <WarnIcon />}
        <span className="text-foreground">{view.text}</span>
      </p>
      {button}
    </div>
  );
}

function LoadingBox({ startedAt }: { startedAt: number }) {
  const now = useNow(true);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const skeleton = (
    <div className="space-y-2 rounded-lg bg-surface p-3">
      <span className="block h-3 w-16 animate-pulse rounded bg-surface-2" />
      <span className="block h-3 w-full animate-pulse rounded bg-surface-2" />
      <span className="block h-3 w-4/5 animate-pulse rounded bg-surface-2" />
    </div>
  );
  return (
    <>
      <div
        aria-busy="true"
        className="mt-3 flex flex-col items-stretch gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center"
      >
        <p className="flex flex-1 items-center gap-2 text-sm">
          <span className="text-accent">
            <Spinner />
          </span>
          <span>
            AI가 분석 중입니다 · 보통 10~20초{" "}
            {/* 경과 초는 매초 읽히지 않게 숨긴다 (10-7) */}
            <span aria-hidden="true" className="text-muted tabular-nums">
              ({elapsed}초)
            </span>
          </span>
        </p>
        <button type="button" disabled className={`${PRIMARY_BUTTON} cursor-not-allowed bg-surface-2 text-muted`}>
          <Spinner />
          분석 중…
        </button>
      </div>
      <div aria-hidden="true" className="mt-3 grid gap-2 sm:grid-cols-3">
        {skeleton}
        {skeleton}
        {skeleton}
      </div>
      <p className="mt-2 text-[11px] text-muted">패널을 접어도 분석은 계속되고, 다시 펼치면 결과가 보여요.</p>
    </>
  );
}

/**
 * 펼친 매치 패널 안의 AI 게임 분석 (변경 10). 상태 ①~⑤와 대상 아님을 그린다.
 * 상태는 `FeedbackProvider`에 있어 패널이 접혀도(언마운트) 진행 중 요청·결과가 남는다.
 */
export default function FeedbackPanel({
  matchId,
  championName,
  eligible,
}: {
  matchId: string;
  championName: string;
  eligible: boolean;
}) {
  const router = useRouter();
  const { entries, limitReached, start, discardError } = useFeedback();
  const entry: FeedbackEntry | undefined = entries[matchId];
  const kind = entry?.kind;

  // 분석이 이 패널이 열린 동안 끝났으면 상태 줄로 1번만 알린다 (렌더 중 이전 값 비교 패턴)
  const [prevKind, setPrevKind] = useState(kind);
  const [announce, setAnnounce] = useState("");
  if (kind !== prevKind) {
    setPrevKind(kind);
    setAnnounce(kind === "loading" ? "AI가 분석 중입니다" : prevKind === "loading" && kind === "done" ? "분석이 끝났어요" : "");
  }

  // 분석 중 버튼이 비활성되며 포커스가 body로 빠지므로, 끝나면 결과 제목(또는 오류 안내)으로 옮긴다
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const lastKind = useRef(kind);
  useEffect(() => {
    const before = lastKind.current;
    lastKind.current = kind;
    if (before !== "loading" || (kind !== "done" && kind !== "error")) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
    (kind === "done" ? headingRef.current : errorRef.current)?.focus();
  }, [kind]);

  let body: ReactNode;
  if (!eligible) {
    body = (
      <>
        <FeedbackHeading />
        <p className="mt-3 flex gap-1.5 rounded-lg border border-dashed border-border p-3 text-sm text-muted">
          <InfoIcon />
          AI 분석은 솔로·자유랭크 15분 이상 경기만 할 수 있어요.
        </p>
      </>
    );
  } else if (entry?.kind === "done") {
    body = (
      <FeedbackResult matchId={matchId} view={entry.view} championName={championName} headingRef={headingRef} />
    );
  } else if (entry?.kind === "loading") {
    body = (
      <>
        <FeedbackHeading />
        <LoadingBox startedAt={entry.startedAt} />
      </>
    );
  } else if (entry?.kind === "error") {
    body = (
      <>
        <FeedbackHeading />
        <ErrorBox
          view={entry.view}
          at={entry.at}
          boxRef={errorRef}
          onRetry={() => start(matchId)}
          onResearch={() => {
            discardError(matchId);
            router.refresh();
          }}
        />
      </>
    );
  } else if (limitReached) {
    body = (
      <>
        <FeedbackHeading />
        <div
          role="alert"
          className="mt-3 flex flex-col items-stretch gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center"
        >
          <p className="flex flex-1 gap-1.5 text-sm text-accent">
            <WarnIcon />
            <span className="text-foreground">{FEEDBACK_LIMIT_TEXT}</span>
          </p>
          <DisabledAnalyzeButton />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <FeedbackHeading />
        <div className="mt-3 flex flex-col items-stretch gap-3 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-muted">
            이 판에서 <b className="font-semibold text-foreground">잘한 점과 부족한 점</b>을 라인전·교전·운영으로
            나눠 정리해 드려요. 버튼을 누르면 분석을 시작하고, 보통 10~20초 걸려요.
          </p>
          <button
            type="button"
            onClick={() => start(matchId)}
            className={`${PRIMARY_BUTTON} bg-accent text-accent-foreground hover:brightness-110`}
          >
            <SparkIcon />
            AI 분석하기
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          검색한 소환사 본인 기준 · 하루 20회까지 · 결과는 Riot 경기 기록으로 만든 문장이며 틀릴 수 있어요
        </p>
      </>
    );
  }

  return (
    <>
      {body}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </>
  );
}
