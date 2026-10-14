// 수집 프리셋 (test, main) + CLI 덮어쓰기 (back_spec 7-2, 7-3)

export const ALLOWED_TIERS = ['PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'] as const;
export type Tier = (typeof ALLOWED_TIERS)[number];
/** league-v4 entries/{tier}/{division}으로 뽑을 수 있는 티어 (디비전이 있는 티어) */
export const DIVISION_TIERS: readonly Tier[] = ['PLATINUM', 'EMERALD', 'DIAMOND'];
export const DIVISIONS = ['I', 'II', 'III', 'IV'] as const;
export type Division = (typeof DIVISIONS)[number];

export interface CollectionConfig {
  preset: string;
  tiers: Tier[];
  playersPerTier: number;
  gamesPerPlayer: number;
  queue: number;
  minGameDurationSec: number;
  keepPatches: number;
  maxGamesPerPatch: number;
  maxMatchesPerRun: number | null;
}

export interface RiotClientConfig {
  perSecondLimit: number;
  perWindowLimit: number;
  windowMs: number;
  requestTimeoutMs: number;
  retry5xx: number;
  retry429: number;
  default429WaitSec: number;
  maxConsecutiveMatchFailures: number;
  aggregateStatementTimeout: string;
  rateLogIntervalMs: number;
}

export const RIOT_CLIENT_CONFIG: RiotClientConfig = {
  perSecondLimit: 19,
  perWindowLimit: 98,
  windowMs: 120_000,
  requestTimeoutMs: 10_000,
  retry5xx: 3,
  retry429: 5,
  default429WaitSec: 10,
  maxConsecutiveMatchFailures: 20,
  aggregateStatementTimeout: '5min',
  rateLogIntervalMs: 10 * 60_000,
};

const BASE = {
  gamesPerPlayer: 20,
  queue: 420,
  minGameDurationSec: 300,
  keepPatches: 2,
  maxGamesPerPatch: 25_000,
  maxMatchesPerRun: null,
} as const;

export const PRESETS: Record<string, CollectionConfig> = {
  test: { preset: 'test', tiers: ['PLATINUM', 'EMERALD', 'DIAMOND'], playersPerTier: 50, ...BASE },
  // 본 수집 (자리만). 4:4:2 비율과 마스터 이상은 테스트 뒤 정한다.
  main: { preset: 'main', tiers: ['EMERALD', 'DIAMOND'], playersPerTier: 200, ...BASE },
};

export interface CollectionOverrides {
  tiers?: string[];
  playersPerTier?: number;
  gamesPerPlayer?: number;
  maxMatches?: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

export function buildCollectionConfig(presetName: string, o: CollectionOverrides = {}): CollectionConfig {
  const base = PRESETS[presetName];
  if (!base) throw new ConfigError(`알 수 없는 프리셋: ${presetName} (test, main 중 하나)`);
  const cfg: CollectionConfig = { ...base, tiers: [...base.tiers] };
  if (o.tiers) {
    const tiers = o.tiers.map((t) => t.trim().toUpperCase()).filter(Boolean);
    for (const t of tiers) {
      if (!DIVISION_TIERS.includes(t as Tier)) {
        throw new ConfigError(`--tiers는 ${DIVISION_TIERS.join(', ')}만 쓸 수 있습니다 (마스터 이상은 본 수집 범위): ${t}`);
      }
    }
    if (tiers.length === 0) throw new ConfigError('--tiers가 비어 있습니다.');
    cfg.tiers = [...new Set(tiers)] as Tier[];
  }
  if (o.playersPerTier !== undefined) cfg.playersPerTier = positiveInt('--players-per-tier', o.playersPerTier, 1000);
  if (o.gamesPerPlayer !== undefined) cfg.gamesPerPlayer = positiveInt('--games-per-player', o.gamesPerPlayer, 100);
  if (o.maxMatches !== undefined) cfg.maxMatchesPerRun = positiveInt('--max-matches', o.maxMatches, 1_000_000);
  return cfg;
}

function positiveInt(name: string, v: number, max: number): number {
  if (!Number.isInteger(v) || v < 1 || v > max) throw new ConfigError(`${name}는 1~${max} 정수여야 합니다.`);
  return v;
}

/** 티어당 인원을 디비전 I~IV에 나눔. 50 → 13/13/12/12 (나머지는 앞 디비전부터) */
export function divisionQuota(playersPerTier: number): Record<Division, number> {
  const base = Math.floor(playersPerTier / DIVISIONS.length);
  let rest = playersPerTier % DIVISIONS.length;
  const out = {} as Record<Division, number>;
  for (const d of DIVISIONS) {
    out[d] = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest--;
  }
  return out;
}
