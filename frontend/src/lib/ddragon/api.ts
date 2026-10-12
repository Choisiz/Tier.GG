import { DDRAGON_BASE_URL, LOCALE, REVALIDATE_SECONDS } from "./constants";
import {
  sortChampions,
  toChampionDetail,
  toChampionSummary,
} from "./transform";
import type {
  ChampionDetail,
  ChampionSummary,
  DDragonChampionDetailResponse,
  DDragonChampionListResponse,
} from "./types";

/**
 * JSON을 받아 타입 T로 돌려준다. 응답이 실패(4xx/5xx)면 에러를 던진다.
 * @param init 캐시 설정 등 fetch 옵션
 */
async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`Data Dragon 요청 실패 (${res.status}): ${url}`);
  }
  return (await res.json()) as T;
}

/** 버전이 URL에 포함된 데이터는 버전별로 내용이 바뀌지 않으므로 영구 캐시 */
const IMMUTABLE: RequestInit = { cache: "force-cache" };

/** 최신 패치 버전 (`versions.json`의 0번째). 1시간마다 새 패치 확인. */
export async function getLatestVersion(): Promise<string> {
  const versions = await fetchJson<string[]>(
    `${DDRAGON_BASE_URL}/api/versions.json`,
    {
      next: { revalidate: REVALIDATE_SECONDS },
    },
  );
  const latest = versions[0];
  if (!latest) {
    throw new Error("Data Dragon 버전 정보가 비어 있습니다.");
  }
  return latest;
}

/** 지정 버전의 champion.json 원본 (가공 전). 목록·상세 함수가 함께 사용 */
async function getRawChampionList(
  version: string,
): Promise<DDragonChampionListResponse> {
  return fetchJson<DDragonChampionListResponse>(
    `${DDRAGON_BASE_URL}/cdn/${version}/data/${LOCALE}/champion.json`,
    IMMUTABLE,
  );
}

/** 전체 챔피언 목록 (한글 이름 가나다순) */
export async function getChampionList(): Promise<ChampionSummary[]> {
  const version = await getLatestVersion();
  const list = await getRawChampionList(version);
  return sortChampions(
    Object.values(list.data).map((champion) =>
      toChampionSummary(champion, version),
    ),
  );
}

/**
 * 챔피언 상세. 목록에 없는 id면 `null`.
 * (Data Dragon은 없는 챔피언에 404가 아닌 403을 주므로 목록으로 먼저 확인한다.)
 */
export async function getChampionDetail(
  id: string,
): Promise<ChampionDetail | null> {
  const version = await getLatestVersion();
  const list = await getRawChampionList(version);
  if (!Object.hasOwn(list.data, id) || list.data[id].id !== id) {
    return null;
  }

  const detail = await fetchJson<DDragonChampionDetailResponse>(
    `${DDRAGON_BASE_URL}/cdn/${version}/data/${LOCALE}/champion/${encodeURIComponent(id)}.json`,
    IMMUTABLE,
  );
  const raw = detail.data[id];
  if (!raw) {
    throw new Error(`챔피언 상세 데이터에 ${id} 항목이 없습니다.`);
  }
  return toChampionDetail(raw, version);
}
