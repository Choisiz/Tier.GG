// 소환사 검색 캐시: Map 기반, 외부 의존성 없음 (back_spec 변경 03 W-3).
// TTL이 지나면 지운다(지연 정리, 읽을 때만 확인). 최대 크기를 넘으면 가장 오래 넣은 것부터 지운다.
// 실패 응답은 호출하는 쪽(summonerSearch)이 set()을 부르지 않아 캐시되지 않는다.

export interface SummonerCache<T> {
  get(key: string, nowMs: number): T | undefined;
  set(key: string, value: T, nowMs: number): void;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export function createSummonerCache<T>(ttlMs: number, maxSize: number): SummonerCache<T> {
  const map = new Map<string, Entry<T>>();

  return {
    get(key, nowMs) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= nowMs) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, nowMs) {
      // 이미 있으면 지우고 다시 넣어 Map의 삽입 순서(= 넣은 시각 순서)를 최신으로 되돌린다.
      map.delete(key);
      map.set(key, { value, expiresAt: nowMs + ttlMs });
      while (map.size > maxSize) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined) break;
        map.delete(oldestKey);
      }
    },
  };
}
