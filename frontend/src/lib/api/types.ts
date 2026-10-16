import "server-only";

/* ───────── 백엔드 API 계약 v2 응답 타입 (docs/contracts/api_contract.md) ─────────
 * 계약에 있는 필드만 적는다. 응답에 모르는 필드가 있어도 쓰지 않는다 (계약 1장).
 */

/** 포지션 (대문자만, 계약 1장) */
export type Position = "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY";

/** 티어 1~5. `null` = 표본 부족 (`rules.minTierPick` 미만) */
export type Tier = 1 | 2 | 3 | 4 | 5 | null;

/** 창 안 패치 1개 (계약 2-0) */
export type WindowPatch = {
  /** 내부 값 "16.20" — Data Dragon 버전 찾기에만 쓴다 */
  patch: string;
  /** 공개 이름 "26.20" — 화면에는 이것만 쓴다 */
  displayName: string;
  games: number;
  /** 소수 2자리 % */
  share: number;
};

/** 통계 기간 (모든 통계 응답 공통, 계약 2-0) */
export type StatsWindow = {
  days: number;
  start: string;
  end: string;
  games: number;
  aggregatedAt: string;
  isStale: boolean;
  /** 최신 패치 먼저, 1개 이상 */
  patches: WindowPatch[];
};

/** GET /meta (계약 2-2) */
export type MetaResponse = {
  window: StatsWindow;
  lastCollectedAt: string | null;
  positions: Position[];
  rules: {
    minTierPick: number;
    secondaryPositionMinShare: number;
    windowDays: number;
    staleAfterHours: number;
  };
};

/** 티어 표 1행 (계약 2-3) */
export type TierRow = {
  rank: number;
  /** Data Dragon champion.json의 `key` (숫자) */
  championId: number;
  tier: Tier;
  tierScore: number;
  winRate: number;
  pickRate: number;
  banRate: number;
  pick: number;
  win: number;
  ban: number;
  positionShare: number;
  mainPositions: Position[];
};

/** GET /champions?position= (계약 2-3) */
export type TierListResponse = {
  window: StatsWindow;
  position: Position;
  champions: TierRow[];
};

/** 상세의 주 포지션 1개 (계약 2-4) */
export type PositionSummary = {
  position: Position;
  pick: number;
  positionShare: number;
  tier: Tier;
  tierScore: number;
  winRate: number;
  pickRate: number;
};

/** 선택 포지션 요약 (계약 2-4) */
export type StatsSummary = {
  tier: Tier;
  tierScore: number;
  winRate: number;
  pickRate: number;
  banRate: number;
  pick: number;
  win: number;
  ban: number;
};

/** 각 빌드 공통 숫자. `pickRate` = 사용률 (`pick / stats.pick`) */
type BuildCounts = {
  pick: number;
  win: number;
  winRate: number;
  pickRate: number;
};

export type ItemBuild = BuildCounts & { itemId: number };

export type RuneBuild = BuildCounts & {
  primaryStyle: number;
  /** 4개, 0번이 핵심 룬 */
  primaryPerks: number[];
  subStyle: number;
  /** 2개 */
  subPerks: number[];
  statPerks: { offense: number; flex: number; defense: number };
};

export type SpellBuild = BuildCounts & {
  /** [작은 번호, 큰 번호]. D/F 위치 정보 없음 */
  spellIds: number[];
};

export type SkillBuild = BuildCounts & {
  /** `^[QWER]{11}$`, 1번째 글자 = 1레벨 */
  skillOrder: string;
};

/** GET /champions/:championId (계약 2-4) */
export type ChampionStatsResponse = {
  window: StatsWindow;
  championId: number;
  position: Position;
  isMainPosition: boolean;
  positions: PositionSummary[];
  stats: StatsSummary;
  builds: {
    items: ItemBuild[];
    runes: RuneBuild[];
    spells: SpellBuild[];
    skills: SkillBuild[];
  };
};

/** 오류 응답 (계약 3장). 분기는 `code`로만 한다 */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
