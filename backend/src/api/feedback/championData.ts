// 챔피언 태그·한국어 이름 공급 (back_spec 변경 05, 05-5 B안).
// 판의 gameVersion(예: 16.21.534.1234) → 메이저.마이너(16.21) → Data Dragon versions.json에서 그 접두어의 첫 버전(16.21.1)
// → cdn/{ver}/data/ko_KR/champion.json을 처음 필요할 때 받아 메모리에 둔다(버전 최대 4개, 진행 중 공유).
// 받기 실패·시간 초과면 저장소 스냅숏을 쓰고 경고(10분에 1번). 새 의존성 없음(Node 내장 fetch).
import { readFileSync } from 'node:fs';
import { championNamesFromJson } from '../../analysis/feedback.js';
import { championTagsFromJson } from '../../analysis/index.js';
import type { ChampionTags } from '../../analysis/types.js';
import type { Logger } from '../../lib/logger.js';

export interface ChampionData {
  /** 실제로 쓴 Data Dragon 버전 (응답 meta.championDataVersion) */
  version: string;
  tags: ChampionTags;
  names: ReadonlyMap<number, string>;
  source: 'ddragon' | 'snapshot';
}

export interface ChampionDataProvider {
  forGameVersion(gameVersion: string | undefined): Promise<ChampionData>;
}

export type FetchJson = (url: string, timeoutMs: number) => Promise<unknown>;

export interface ChampionDataOptions {
  baseUrl: string;
  timeoutMs: number;
  maxVersions: number;
  versionsTtlMs: number;
  warnIntervalMs: number;
  snapshot: ChampionData;
  logger: Logger;
  fetchJson?: FetchJson;
  now?: () => number;
}

/** 실제 fetch: 200이 아니면 던진다. 시간 제한은 AbortSignal.timeout */
export const defaultFetchJson: FetchJson = async (url, timeoutMs) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
};

/** 스냅숏 파일({version, champions:[{key,name,tags}]}) → ChampionData */
export function loadSnapshot(path: string): ChampionData {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown };
  const version = typeof json.version === 'string' ? json.version : 'snapshot';
  return { version, tags: championTagsFromJson(json), names: championNamesFromJson(json), source: 'snapshot' };
}

/** "16.21.534.1234" → "16.21". 형식이 아니면 null */
export function patchPrefix(gameVersion: string | undefined): string | null {
  const m = /^(\d+)\.(\d+)(?:\.|$)/.exec(gameVersion ?? '');
  return m ? `${m[1]}.${m[2]}` : null;
}

/** versions.json(최신이 앞)에서 접두어가 맞는 첫 버전 */
export function pickVersion(versions: readonly unknown[], prefix: string): string | null {
  for (const v of versions) if (typeof v === 'string' && v.startsWith(`${prefix}.`)) return v;
  return null;
}

export function createChampionData(opts: ChampionDataOptions): ChampionDataProvider {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const now = opts.now ?? Date.now;
  const byVersion = new Map<string, ChampionData>();
  const flights = new Map<string, Promise<ChampionData>>();
  let versions: { list: unknown[]; at: number } | null = null;
  let versionsFlight: Promise<unknown[]> | null = null;
  let lastWarnAt = -Infinity;

  const warn = (msg: string, fields: Record<string, unknown>) => {
    const t = now();
    if (t - lastWarnAt < opts.warnIntervalMs) return;
    lastWarnAt = t;
    opts.logger.warn(msg, fields);
  };

  async function loadVersions(): Promise<unknown[]> {
    if (versions && now() - versions.at < opts.versionsTtlMs) return versions.list;
    if (!versionsFlight) {
      versionsFlight = (async () => {
        const json = await fetchJson(`${opts.baseUrl}/api/versions.json`, opts.timeoutMs);
        if (!Array.isArray(json)) throw new Error('versions.json 형식이 배열이 아님');
        versions = { list: json, at: now() };
        return json;
      })().finally(() => {
        versionsFlight = null;
      });
    }
    return versionsFlight;
  }

  async function loadVersion(ver: string): Promise<ChampionData> {
    const json = await fetchJson(`${opts.baseUrl}/cdn/${encodeURIComponent(ver)}/data/ko_KR/champion.json`, opts.timeoutMs);
    const tags = championTagsFromJson(json);
    const names = championNamesFromJson(json);
    if (tags.size === 0) throw new Error('champion.json에 챔피언이 없음');
    const data: ChampionData = { version: ver, tags, names, source: 'ddragon' };
    byVersion.set(ver, data);
    while (byVersion.size > opts.maxVersions) {
      const oldest = byVersion.keys().next().value;
      if (oldest === undefined) break;
      byVersion.delete(oldest);
    }
    return data;
  }

  return {
    async forGameVersion(gameVersion) {
      const prefix = patchPrefix(gameVersion);
      if (!prefix) {
        warn('Data Dragon: gameVersion 형식이 달라 스냅숏 사용', { gameVersion: gameVersion ?? null, snapshot: opts.snapshot.version });
        return opts.snapshot;
      }
      try {
        const ver = pickVersion(await loadVersions(), prefix);
        if (!ver) {
          warn('Data Dragon: 맞는 버전이 없어 스냅숏 사용', { prefix, snapshot: opts.snapshot.version });
          return opts.snapshot;
        }
        const cached = byVersion.get(ver);
        if (cached) return cached;
        let flight = flights.get(ver);
        if (!flight) {
          flight = loadVersion(ver).finally(() => flights.delete(ver));
          flights.set(ver, flight);
        }
        return await flight;
      } catch (err) {
        warn('Data Dragon 받기 실패, 스냅숏 사용', {
          prefix,
          snapshot: opts.snapshot.version,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
        return opts.snapshot;
      }
    },
  };
}
