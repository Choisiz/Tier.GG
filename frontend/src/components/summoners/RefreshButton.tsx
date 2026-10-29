"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore, useTransition } from "react";

/** 쿨다운 길이. 백엔드 검색 캐시 TTL(60초)과 같아, 활성화된 뒤 누르면 항상 캐시 만료 상태다 (변경 09 Q2) */
const COOLDOWN_SECONDS = 60;

/** 남은 쿨다운 초(올림). 0이면 누를 수 있다 */
function cooldownLeft(fetchedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((fetchedAtMs + COOLDOWN_SECONDS * 1000 - nowMs) / 1000));
}

/** "방금 전 조회" / "N분 전 조회" / "N시간 전 조회". 프론트가 요청한 시각 기준이라 "조회"로 쓴다 */
function fetchedLabel(fetchedAtMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - fetchedAtMs);
  const minute = 60_000;
  if (diff < minute) return "방금 전 조회";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)}분 전 조회`;
  return `${Math.floor(diff / (60 * minute))}시간 전 조회`;
}

/** 1초마다 현재 시각(초 단위로 내림)을 알려 주는 외부 저장소 */
function subscribeSecond(onChange: () => void): () => void {
  const id = setInterval(onChange, 1000);
  return () => clearInterval(id);
}
const getNowSecond = () => Math.floor(Date.now() / 1000) * 1000;

function Spinner() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </svg>
  );
}

/**
 * 갱신하기 버튼 + "N분 전 조회" (변경 09). `router.refresh()`로 서버 컴포넌트를 다시 렌더한다.
 * `fetchedAt`(서버 렌더 시각)부터 60초 동안 잠기고, 갱신이 끝나 새 `fetchedAt`이 내려오면 다시 60초가 시작한다.
 * 서버 렌더·하이드레이션 때는 `fetchedAt`을 "지금"으로 보아(쿨다운 60초, 방금 전) 서버·클라이언트 출력이 같다.
 */
export default function RefreshButton({ fetchedAt }: { fetchedAt: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const fetchedAtMs = new Date(fetchedAt).getTime();
  const nowMs = useSyncExternalStore(subscribeSecond, getNowSecond, () => fetchedAtMs);
  const left = cooldownLeft(fetchedAtMs, nowMs);
  const cooling = left > 0;
  const disabled = isPending || cooling;

  function handleClick() {
    if (disabled) return;
    startTransition(() => {
      router.refresh();
    });
  }

  // 스크린리더용 상태 문구. 상태가 바뀔 때만 달라지도록 초 단위 숫자를 넣지 않는다(1초마다 읽지 않게)
  const status = isPending
    ? "전적을 갱신하는 중입니다"
    : cooling
      ? `다시 갱신하려면 ${COOLDOWN_SECONDS}초를 기다려야 합니다`
      : "갱신할 수 있습니다";

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-3 sm:flex-col-reverse sm:items-end sm:justify-start sm:gap-1.5 sm:border-t-0 sm:pt-0">
      <span className="text-xs text-muted">{isPending ? "조회 중…" : fetchedLabel(fetchedAtMs, nowMs)}</span>
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-busy={isPending}
        aria-describedby="refresh-status"
        className="inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-lg border border-accent/60 bg-surface-2 px-4 text-sm font-semibold whitespace-nowrap text-accent hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-muted disabled:opacity-70 disabled:hover:bg-surface-2 disabled:hover:text-muted"
      >
        {isPending ? <Spinner /> : <RefreshIcon />}
        {isPending ? "갱신 중…" : cooling ? `갱신하기 (${left}초 후)` : "갱신하기"}
      </button>
      <span id="refresh-status" role="status" className="sr-only">
        {status}
      </span>
    </div>
  );
}
