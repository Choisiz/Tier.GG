"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  chunkIds,
  resolveLaneBatch,
  type BatchFetcher,
  type LaneBatchResponse,
  type LaneCell,
} from "@/lib/view/laneGold";

/**
 * 라인전 칸의 현재 상태.
 * - `idle`: 서버 렌더·수화 직후. `-`로 그린다 (자바스크립트가 꺼져도 거짓 로딩이 남지 않게)
 * - `loading`: 마운트 뒤 아직 결과가 없음 → 회색 막대
 * - `ready`/`none`: 확정 (`none`은 `-`)
 */
export type LaneState = { kind: "idle" } | { kind: "loading" } | LaneCell;

type LaneContextValue = { started: boolean; cells: Record<string, LaneCell> };

const LaneGoldContext = createContext<LaneContextValue>({ started: false, cells: {} });

/** 한 matchId의 라인전 상태. Provider 밖이면 항상 `idle`(`-`) */
export function useLaneState(matchId: string): LaneState {
  const { started, cells } = useContext(LaneGoldContext);
  if (!started) return { kind: "idle" };
  return cells[matchId] ?? { kind: "loading" };
}

const subscribeNothing = () => () => {};

/** 같은 출처 Route Handler 한 묶음 호출. 어떤 실패든 null (자동 재시도 없음) */
const fetchBatch = (puuid: string): BatchFetcher => async (matchIds, signal) => {
  try {
    const response = await fetch(
      `/api/lane-gold?puuid=${encodeURIComponent(puuid)}&matchIds=${matchIds.join(",")}`,
      { cache: "no-store", signal },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !Array.isArray((body as { results?: unknown }).results)
    ) {
      return null;
    }
    return body as LaneBatchResponse;
  } catch {
    return null;
  }
};

/**
 * 매치 목록을 감싸 라인전 15분 골드를 마운트 뒤에 10개씩 나눠 가져온다 (변경 08).
 * 묶음은 동시에 보낸다. 페이지를 떠나면 진행 중 요청과 대기 타이머를 취소한다.
 */
export default function LaneGoldProvider({
  puuid,
  matchIds,
  children,
}: {
  puuid: string;
  matchIds: string[];
  children: ReactNode;
}) {
  const [cells, setCells] = useState<Record<string, LaneCell>>({});
  // 서버·수화 중에는 false, 수화가 끝나면 true (effect 안에서 setState 하지 않고 마운트를 알아낸다)
  const started = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const idsKey = matchIds.join(",");

  useEffect(() => {
    if (!idsKey) return;
    const controller = new AbortController();
    const onUpdate = (updates: Record<string, LaneCell>) => {
      if (controller.signal.aborted) return;
      setCells((prev) => ({ ...prev, ...updates }));
    };
    const fetcher = fetchBatch(puuid);
    for (const batch of chunkIds(idsKey.split(","))) {
      void resolveLaneBatch(batch, fetcher, onUpdate, controller.signal);
    }
    return () => controller.abort();
  }, [puuid, idsKey]);

  return <LaneGoldContext.Provider value={{ started, cells }}>{children}</LaneGoldContext.Provider>;
}
