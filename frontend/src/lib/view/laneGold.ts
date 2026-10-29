/**
 * 라인전 15분 골드(변경 08) 순수 함수 모음. React·Next·서버 전용 모듈을 가져오지 않는다
 * (scratchpad 스크립트로 확인하기 쉽게, 서버 Route Handler와 클라이언트 컴포넌트가 함께 쓴다).
 * 포지션 판정·골드 계산은 하지 않는다. 백엔드가 준 `myPercent`를 보여주기만 한다.
 */

/** 한 번에 보내는 matchId 수 (계약 2-6: 1~10개) */
export const LANE_GOLD_BATCH_SIZE = 10;
/** `pending` 재시도 횟수 상한 (계약 2-6). 처음 요청은 포함하지 않는다 */
export const LANE_GOLD_MAX_RETRIES = 3;
/** `retryAfterSec`가 없거나 범위(1~120) 밖일 때 쓰는 대기 시간 */
export const LANE_GOLD_DEFAULT_RETRY_SEC = 2;
/** 한 번 기다리는 시간 상한 (사용자 승인 2026-10-30) */
export const LANE_GOLD_MAX_WAIT_SEC = 30;

const PUUID_PATTERN = /^[0-9A-Za-z_-]{1,100}$/;
const MATCH_ID_PATTERN = /^KR_[0-9]{1,15}$/;

export function isValidPuuid(value: string): boolean {
  return PUUID_PATTERN.test(value);
}

/**
 * 쉼표로 구분한 `matchIds` → 배열. 1~10개이고 각 항목이 `KR_숫자` 형식이 아니면 null (400 대상).
 */
export function parseMatchIds(raw: string | null): string[] | null {
  if (!raw) return null;
  const ids = raw.split(",");
  if (ids.length < 1 || ids.length > LANE_GOLD_BATCH_SIZE) return null;
  return ids.every((id) => MATCH_ID_PATTERN.test(id)) ? ids : null;
}

/** 배열을 `size`개씩 자른다 (20게임 → 10 + 10) */
export function chunkIds<T>(items: readonly T[], size: number = LANE_GOLD_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** `retryAfterSec` → 기다릴 초. 정수 1~120이 아니면 2초, 30초를 넘으면 30초로 자른다 */
export function normalizeRetrySec(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 120) {
    return LANE_GOLD_DEFAULT_RETRY_SEC;
  }
  return Math.min(Math.round(value), LANE_GOLD_MAX_WAIT_SEC);
}

export type LaneTone = "ahead" | "even" | "behind";

/** 내 쪽 52 이상 앞섬, 48~51 비슷함, 47 이하 뒤짐 (±2%p는 동률로 본다, 승인 2026-10-30) */
export function laneTone(myPercent: number): LaneTone {
  if (myPercent >= 52) return "ahead";
  if (myPercent <= 47) return "behind";
  return "even";
}

/** 내 쪽 먼저. 두 자리 패딩 없음 ("5:95") */
export function formatLanePercent(myPercent: number): string {
  return `${myPercent}:${100 - myPercent}`;
}

/** `55` → "55%", null이면 "-" */
export function formatKillParticipation(value: number | null): string {
  return value === null ? "-" : `${value}%`;
}

/* ───────── 묶음 처리 (재시도 포함) ───────── */

/** 한 칸의 확정 결과. 이 기록이 없으면 아직 로딩 중이다 */
export type LaneCell = { kind: "ready"; myPercent: number } | { kind: "none" };

/** 백엔드(프록시)에서 받은 한 묶음 응답의 최소 모양 */
export type LaneBatchResponse = {
  results: { matchId: string; state: string; myPercent: number | null }[];
  retryAfterSec: number | null;
};

/** 한 묶음 요청. 오류·시간 초과·형식 오류·취소는 모두 null */
export type BatchFetcher = (
  matchIds: string[],
  signal: AbortSignal,
) => Promise<LaneBatchResponse | null>;

/** `ms` 뒤에 true. 그 사이 취소되면 false (타이머는 정리한다) */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * 묶음 1개를 끝까지 처리한다.
 * - `ready` → 값, `unavailable`·응답에 없음·값 이상 → `-` 확정
 * - `pending` → `retryAfterSec` 뒤 **그 ID만** 다시 요청, 최대 3번. 그래도 `pending`이면 `-`
 * - 요청 자체가 실패(null)하면 아직 남은 ID를 모두 `-` (자동 재시도 없음)
 * 취소되면 아무것도 더 알리지 않고 끝낸다.
 */
export async function resolveLaneBatch(
  matchIds: string[],
  fetchBatch: BatchFetcher,
  onUpdate: (updates: Record<string, LaneCell>) => void,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<boolean> = abortableSleep,
): Promise<void> {
  const none = (ids: string[]): Record<string, LaneCell> =>
    Object.fromEntries(ids.map((id) => [id, { kind: "none" } as LaneCell]));

  let pending = matchIds;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchBatch(pending, signal);
    if (signal.aborted) return;
    if (!response) {
      onUpdate(none(pending));
      return;
    }

    const byId = new Map(response.results.map((item) => [item.matchId, item]));
    const updates: Record<string, LaneCell> = {};
    const stillPending: string[] = [];
    for (const id of pending) {
      const item = byId.get(id);
      if (item?.state === "pending") {
        stillPending.push(id);
      } else if (
        item?.state === "ready" &&
        typeof item.myPercent === "number" &&
        Number.isInteger(item.myPercent) &&
        item.myPercent >= 0 &&
        item.myPercent <= 100
      ) {
        updates[id] = { kind: "ready", myPercent: item.myPercent };
      } else {
        updates[id] = { kind: "none" };
      }
    }
    onUpdate(updates);

    if (stillPending.length === 0) return;
    if (attempt >= LANE_GOLD_MAX_RETRIES) {
      onUpdate(none(stillPending));
      return;
    }
    const slept = await sleep(normalizeRetrySec(response.retryAfterSec) * 1000, signal);
    if (!slept || signal.aborted) return;
    pending = stillPending;
  }
}
