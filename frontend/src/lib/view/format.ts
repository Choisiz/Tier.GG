import type { StatsWindow, WindowPatch } from "@/lib/api/types";

/**
 * 52.76 → "52.8%". 소수 1자리 사사오입.
 * API 비율은 소수 2자리라 먼저 1/100 단위 정수로 맞춘 뒤 반올림한다
 * (`toFixed`만 쓰면 2.15 → "2.1"처럼 이진 소수 오차로 내림이 된다).
 */
export function formatPercent(value: number): string {
  const tenths = Math.round(Math.round(value * 100) / 10);
  return `${(tenths / 10).toFixed(1)}%`;
}

/** 3952 → "3,952" */
export function formatCount(value: number): string {
  return value.toLocaleString("ko-KR");
}

const KST_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO 시각 → KST 고정 "10월 15일 03:52" (서버에서 만들어 수화 불일치 없음) */
export function formatKst(iso: string): string {
  const parts = Object.fromEntries(
    KST_FORMAT.formatToParts(new Date(iso)).map((part) => [part.type, part.value]),
  );
  return `${parts.month}월 ${parts.day}일 ${parts.hour}:${parts.minute}`;
}

/**
 * 패치 구성 글자. 화면에는 `displayName`만 쓴다 (계약 1장·5장).
 * 2개 이상: "26.20 67% / 26.19 33%", 1개: "패치 26.20".
 * 반올림 합이 99·101%여도 그대로 둔다 (계약 2-0).
 */
export function formatPatchMix(patches: WindowPatch[]): string {
  if (patches.length === 1) {
    return `패치 ${patches[0].displayName}`;
  }
  return patches
    .map((patch) => `${patch.displayName} ${Math.round(patch.share)}%`)
    .join(" / ");
}

/** WindowInfo가 쓰는 글자 묶음 */
export type WindowInfoView = {
  days: number;
  games: string;
  patchMix: string;
  aggregatedAt: string;
  isStale: boolean;
};

/* ───────── 전적 검색 (변경 06) ───────── */

/**
 * 상대 시각 "12분 전" / "3시간 전" / "5일 전". 30일 넘으면 KST 날짜("10월 15일")로 바꾼다.
 * 요청 시점(`Date.now()`) 기준이라 동적 렌더링(`force-dynamic`)에서만 쓴다.
 */
export function formatRelativeKo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "방금 전";
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}분 전`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}시간 전`;
  if (diffMs < 30 * day) return `${Math.floor(diffMs / day)}일 전`;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.month}월 ${parts.day}일`;
}

/** 1584 → "26분 24초" */
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return `${minutes}분 ${String(remain).padStart(2, "0")}초`;
}

/** KDA 비율. (킬+어시) / 데스(0이면 1로 나눔). 소수 2자리 "4.00" */
export function formatKda(kills: number, deaths: number, assists: number): string {
  return ((kills + assists) / Math.max(1, deaths)).toFixed(2);
}

/** 분당 CS. "6.4" */
export function formatCsPerMinute(cs: number, gameDurationSec: number): string {
  const minutes = gameDurationSec / 60;
  if (minutes <= 0) return "0.0";
  return (cs / minutes).toFixed(1);
}

export function toWindowInfoView(window: StatsWindow): WindowInfoView {
  return {
    days: window.days,
    games: formatCount(window.games),
    patchMix: formatPatchMix(window.patches),
    aggregatedAt: formatKst(window.aggregatedAt),
    isStale: window.isStale,
  };
}
