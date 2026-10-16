import { DDRAGON_BASE_URL, LOCALE, REVALIDATE_SECONDS } from "./constants";
import { itemIconUrl, runeIconUrl, summonerSpellIconUrl } from "./images";
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
  DDragonItemListResponse,
  DDragonRuneTree,
  DDragonSummonerSpellListResponse,
  IconInfo,
  ItemInfo,
  RuneTreeInfo,
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

/** 전체 버전 목록 (최신 먼저). 1시간마다 새 패치 확인. */
async function getVersions(): Promise<string[]> {
  return fetchJson<string[]>(`${DDRAGON_BASE_URL}/api/versions.json`, {
    next: { revalidate: REVALIDATE_SECONDS },
  });
}

/** 최신 패치 버전 (`versions.json`의 0번째). */
export async function getLatestVersion(): Promise<string> {
  const versions = await getVersions();
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

/**
 * 챔피언 숫자 key("266") → 요약. 백엔드 `championId`를 이름·아이콘·상세 링크로 바꿀 때 쓴다.
 */
export async function getChampionKeyMap(): Promise<Map<string, ChampionSummary>> {
  const champions = await getChampionList();
  return new Map(champions.map((champion) => [champion.key, champion]));
}

/**
 * 버전마다 한 번만 가공한다 (버전 포함 주소라 내용이 바뀌지 않는다).
 * 실패한 Promise는 지워 다음 호출에서 다시 시도한다.
 */
function memoByVersion<T>(load: (version: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  return (version: string): Promise<T> => {
    let promise = cache.get(version);
    if (!promise) {
      promise = load(version).catch((error: unknown) => {
        cache.delete(version);
        throw error;
      });
      cache.set(version, promise);
    }
    return promise;
  };
}

const getItemMapForVersion = memoByVersion(async (version) => {
  const raw = await fetchJson<DDragonItemListResponse>(
    `${DDRAGON_BASE_URL}/cdn/${version}/data/${LOCALE}/item.json`,
    IMMUTABLE,
  );
  const map = new Map<string, ItemInfo>();
  for (const [itemId, item] of Object.entries(raw.data)) {
    map.set(itemId, {
      name: item.name,
      iconUrl: itemIconUrl(version, item.image.full),
      tags: item.tags ?? [],
      hasInto: (item.into?.length ?? 0) > 0,
      hasFrom: (item.from?.length ?? 0) > 0,
      builtFromBoots: (item.from ?? []).some((fromId) =>
        raw.data[fromId]?.tags?.includes("Boots"),
      ),
      goldTotal: item.gold.total,
    });
  }
  return map;
});

/**
 * 아이템 ID → 정보. 최신 버전에서 먼저 찾고, 못 찾은 것만 창 안 다른 패치의
 * `{patch}.1` 버전(versions.json에 있을 때만)에서 한 번 더 찾는다 (계약 5장 권장).
 * 끝까지 못 찾은 ID는 결과에 없다.
 * @param patches 통계 창의 내부 패치 값 ("16.20"). displayName("26.20")을 넘기지 않는다
 */
export async function getItems(
  itemIds: number[],
  patches: string[],
): Promise<Map<number, ItemInfo>> {
  const latest = await getLatestVersion();
  const result = new Map<number, ItemInfo>();
  let missing = itemIds;

  const lookup = async (version: string) => {
    const map = await getItemMapForVersion(version);
    missing = missing.filter((itemId) => {
      const info = map.get(String(itemId));
      if (info) {
        result.set(itemId, info);
        return false;
      }
      return true;
    });
  };

  await lookup(latest);
  if (missing.length > 0) {
    const versions = await getVersions();
    for (const patch of patches) {
      const version = `${patch}.1`;
      if (missing.length === 0) break;
      if (version === latest || !versions.includes(version)) continue;
      await lookup(version);
    }
  }
  return result;
}

const getSummonerSpellMapForVersion = memoByVersion(async (version) => {
  const raw = await fetchJson<DDragonSummonerSpellListResponse>(
    `${DDRAGON_BASE_URL}/cdn/${version}/data/${LOCALE}/summoner.json`,
    IMMUTABLE,
  );
  const map = new Map<string, IconInfo>();
  for (const spell of Object.values(raw.data)) {
    map.set(spell.key, {
      name: spell.name,
      iconUrl: summonerSpellIconUrl(version, spell.image.full),
    });
  }
  return map;
});

/** 소환사 주문 숫자 key("4") → 이름·아이콘 */
export async function getSummonerSpells(): Promise<Map<string, IconInfo>> {
  return getSummonerSpellMapForVersion(await getLatestVersion());
}

const getRuneTreesForVersion = memoByVersion(async (version) => {
  const raw = await fetchJson<DDragonRuneTree[]>(
    `${DDRAGON_BASE_URL}/cdn/${version}/data/${LOCALE}/runesReforged.json`,
    IMMUTABLE,
  );
  return raw.map(
    (tree): RuneTreeInfo => ({
      id: tree.id,
      name: tree.name,
      iconUrl: runeIconUrl(tree.icon),
      rows: tree.slots.map((slot) =>
        slot.runes.map((rune) => ({
          id: rune.id,
          name: rune.name,
          iconUrl: runeIconUrl(rune.icon),
        })),
      ),
    }),
  );
});

/** 룬 트리 목록 (줄별 룬 포함) */
export async function getRuneTrees(): Promise<RuneTreeInfo[]> {
  return getRuneTreesForVersion(await getLatestVersion());
}
