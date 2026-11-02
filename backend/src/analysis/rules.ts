// 판정 규칙 상수. feedback_design.md의 표 하나 = 상수 하나. 경계값·비율의 유일한 출처다.
// 규칙이나 경계값을 바꾸면 ENGINE_VERSION을 올린다 (5단계 캐시 키에 들어간다).
import type { Grade, Position, Role } from './types.js';

export const ENGINE_VERSION = '2026-11-02.2';

/** 5개 등급을 높은 순서로 */
export const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D', 'E'];

/** 4장: 등급 점수 (반영 비율에 곱함) */
export const GRADE_POINT: Readonly<Record<Grade, number>> = { A: 1, B: 0.75, C: 0.5, D: 0.25, E: 0 };

/** 경계 4개 [A 하한, B 하한, C 하한, D 하한]. 하한 이상이면 그 등급, D 하한 미만이면 E */
export type Cuts = readonly [number, number, number, number];

/** 0 초과(아주 작은 양수)를 D 하한으로 쓰기 위한 값. "0이면 E, 0보다 크면 D 이상" */
export const ABOVE_ZERO = Number.MIN_VALUE;

// ---------- 2-1. 결정적 장면 ----------
export const KEY_MOMENT = {
  /** 싸움 직전 분 → 싸움 끝 60초 뒤 분의 팀 골드 차 변화 */
  goldSwingMin: 3000,
  killsMin: 5,
  max: 3,
  /** 싸움 끝 뒤 몇 ms의 스냅샷을 "뒤"로 보나 */
  afterMs: 60_000,
} as const;

// ---------- 2-2. 요약 ----------
export const SUMMARY = {
  /** 라인전 점수 합 +2 이상 우세, −2 이하 열세 */
  laningSumCut: 2,
  /** 총점 70 이상 잘함, 40 미만 부족 (초안) */
  totalGood: 70,
  totalBad: 40,
} as const;

// ---------- 3. 라인전 ----------
export const LANING = {
  defaultSec: 900,
  minSec: 600,
} as const;

/** 3장: 포지션별로 보는 라인 (서폿은 바텀, 정글은 15분 고정이라 없음) */
export const LANE_OF_POSITION: Readonly<Record<Position, string | null>> = {
  TOP: 'TOP_LANE',
  JUNGLE: null,
  MIDDLE: 'MID_LANE',
  BOTTOM: 'BOT_LANE',
  UTILITY: 'BOT_LANE',
};

/** 3장: CS(보조)는 미드·원딜만 */
export const LANING_CS_POSITIONS: readonly Position[] = ['MIDDLE', 'BOTTOM'];

// ---------- 4·5. 교전 공통 ----------
/** 5장: 오브젝트 싸움 = 처치 시각 앞뒤 40초 (겹치면 합침) */
export const OBJECTIVE_WINDOW_MS = 40_000;
/** 2-1·6-1: 싸움 = 킬 사이 간격 20초 이하로 묶음 */
export const FIGHT_GAP_MS = 20_000;
/** 6-1 운영 이득: 싸움 시작 ~ 마지막 킬 60초 뒤까지의 포탑·억제기를 그 싸움 득실로 본다 (검산 스크립트 macro.py와 같음) */
export const FIGHT_BUILDING_TAIL_MS = 60_000;

// ---------- 5-1. 교전 반영 비율 ----------
export interface FightWeights {
  advantage: number;
  damage: number;
  vision: number;
  objective: number;
}
export const FIGHT_WEIGHTS: Readonly<Record<Role, FightWeights>> = {
  TOP_TANK: { advantage: 60, damage: 30, vision: 5, objective: 5 },
  TOP_DAMAGE: { advantage: 30, damage: 60, vision: 5, objective: 5 },
  JUNGLE_TANK: { advantage: 30, damage: 10, vision: 10, objective: 50 },
  JUNGLE_DAMAGE: { advantage: 20, damage: 30, vision: 10, objective: 40 },
  MID_TANK: { advantage: 60, damage: 20, vision: 10, objective: 10 },
  MID_DAMAGE: { advantage: 20, damage: 60, vision: 10, objective: 10 },
  ADC: { advantage: 5, damage: 85, vision: 5, objective: 5 },
  SUPPORT_TANK: { advantage: 50, damage: 5, vision: 40, objective: 5 },
  SUPPORT_DAMAGE: { advantage: 5, damage: 60, vision: 30, objective: 5 },
  SUPPORT_UTILITY: { advantage: 20, damage: 15, vision: 60, objective: 5 },
};

// ---------- 5-2. 딜 ----------
/** 구간 [시작 분, 끝 분). 끝은 게임 끝 스냅샷에서 자른다 */
export const DAMAGE_PHASES: readonly (readonly [number, number])[] = [
  [0, 15],
  [15, 30],
  [30, Infinity],
];
/** 구간이 3분 미만이면 판정하지 않음 */
export const DAMAGE_PHASE_MIN_MS = 180_000;
/** 유형별 구간 기대 비중 (팀 내 %) */
export const DAMAGE_EXPECTED: Readonly<Record<Role, readonly [number, number, number]>> = {
  ADC: [22, 23, 28],
  MID_DAMAGE: [20, 22, 22],
  MID_TANK: [18, 16, 14],
  TOP_DAMAGE: [22, 20, 18],
  TOP_TANK: [18, 16, 14],
  JUNGLE_DAMAGE: [16, 18, 16],
  JUNGLE_TANK: [13, 16, 14],
  SUPPORT_DAMAGE: [18, 16, 14],
  SUPPORT_TANK: [12, 10, 8],
  SUPPORT_UTILITY: [11, 6, 8],
};
/**
 * 딜 등급: 기대 비중과의 차이(%p). A +6 이상 · B +3~6 · C ±3 안 · D −3~−6 · E −6 이하.
 * C는 양쪽 3 "미만"이고, D·E 경계(−3, −6)는 "이하"다 (3%p 이상 낮으면 못함).
 */
export const DAMAGE_DIFF = { a: 6, b: 3, d: -3, e: -6 } as const;

// ---------- 5-3. 오브젝트 ----------
export const OBJECTIVE_POINTS = {
  BARON_NASHOR: 50,
  DRAGON: 10,
  /** 팀의 4번째 용 (용 10 대신) */
  SOUL_DRAGON: 50,
  ELDER_DRAGON: 80,
  RIFTHERALD: 10,
  /** 공허 유충 1마리 */
  HORDE: 4,
} as const;
/** 팀의 몇 번째 (장로 제외) 용이 영혼 용인가 */
export const SOUL_DRAGON_NTH = 4;
/** 정글: 그 판 막타 점수 합. A 82 이상 · B 42~82 · C 22~42 · D 10~22 · E 10 미만 (2026-11-02 영혼 용 = 4번째 용 기준 재계산) */
export const JUNGLE_OBJECTIVE_CUTS: Cuts = [82, 42, 22, 10];

// ---------- 5-4. 이득 여부 ----------
/** 킬 점수: 죽은 플레이어의 포지션 */
export const KILL_POINTS: Readonly<Record<Position, number>> = { TOP: 5, JUNGLE: 5, MIDDLE: 7, BOTTOM: 7, UTILITY: 5 };
export const TURRET_POINTS = 10;
export const INHIBITOR_POINTS = 20;
/** 우리 팀 몫(%). A 78 이상 · B 64~78 · C 40~64 · D 24~40 · E 24 미만 (2026-11-02 영혼 용 = 4번째 용 기준 재계산) */
export const FIGHT_ADVANTAGE_CUTS: Cuts = [78, 64, 40, 24];
/** 5-4-1: 탱 첫 데스의 이니시 확신도 — 죽기 직전 피해를 준 상대 수 */
export const INITIATE_MIN_ENEMIES = 3;

// ---------- 5-5. 시야 ----------
export const VISION_WINDOW_MS = 60_000;
/** 시야 창을 여는 오브젝트 (용·바론·전령. 장로용도 DRAGON) */
export const VISION_OBJECTIVE_TYPES: readonly string[] = ['DRAGON', 'BARON_NASHOR', 'RIFTHERALD'];
/** 와드 설치 점수 (그 밖 wardType은 0) */
export const WARD_PLACED_POINTS: Readonly<Record<string, number>> = {
  CONTROL_WARD: 3,
  SIGHT_WARD: 1,
  YELLOW_TRINKET: 1,
  BLUE_TRINKET: 1,
};
export const WARD_KILL_POINTS = 2;
/** 오브젝트 1개당 시야 점수, 포지션별 */
export const FIGHT_VISION_CUTS: Readonly<Record<Position, Cuts>> = {
  TOP: [1.0, 0.6, 0.4, 0.2],
  JUNGLE: [1.7, 1.1, 0.7, 0.3],
  MIDDLE: [1.2, 0.8, 0.4, 0.2],
  BOTTOM: [1.4, 1.0, 0.6, 0.2],
  UTILITY: [4.0, 3.0, 2.5, 1.7],
};

// ---------- 6. 운영 ----------
export interface MacroWeights {
  advantage: number;
  solo: number;
  side: number;
  farm: number;
  vision: number;
}
/** 6-2: 반영 비율. 표의 "-"는 0 (매기지 않음) */
export const MACRO_WEIGHTS: Readonly<Record<Role, MacroWeights>> = {
  TOP_TANK: { advantage: 20, solo: 15, side: 30, farm: 25, vision: 10 },
  TOP_DAMAGE: { advantage: 15, solo: 20, side: 30, farm: 25, vision: 10 },
  JUNGLE_TANK: { advantage: 30, solo: 10, side: 5, farm: 25, vision: 30 },
  JUNGLE_DAMAGE: { advantage: 25, solo: 15, side: 5, farm: 30, vision: 25 },
  MID_TANK: { advantage: 30, solo: 15, side: 15, farm: 25, vision: 15 },
  MID_DAMAGE: { advantage: 20, solo: 20, side: 15, farm: 35, vision: 10 },
  ADC: { advantage: 15, solo: 20, side: 20, farm: 40, vision: 5 },
  SUPPORT_TANK: { advantage: 35, solo: 20, side: 0, farm: 0, vision: 45 },
  SUPPORT_DAMAGE: { advantage: 30, solo: 25, side: 5, farm: 0, vision: 40 },
  SUPPORT_UTILITY: { advantage: 35, solo: 15, side: 0, farm: 0, vision: 50 },
};
/** 6-1 운영 이득 (우리 팀 몫 %) */
export const MACRO_ADVANTAGE_CUTS: Cuts = [74, 62, 42, 29];
/** 6-1 단독 킬·데스 (킬 − 데스): +2 이상 A, +1 B, 0 C, −1 D, −2 이하 E */
export const SOLO_CUTS: Cuts = [2, 1, 0, -1];
/** 6-1 사이드 압박 (분당 포탑 피해). 정글·서폿은 0이면 E, 0 초과면 D 이상 */
export const SIDE_CUTS: Readonly<Record<Position, Cuts>> = {
  TOP: [457, 342, 240, 155],
  MIDDLE: [370, 249, 168, 97],
  BOTTOM: [464, 315, 201, 114],
  JUNGLE: [131, 63, 6, ABOVE_ZERO],
  UTILITY: [90, 44, 21, ABOVE_ZERO],
};
/** 6-1 중후반 파밍 (15분 이후 분당 CS). 서폿은 매기지 않음 */
export const FARM_CUTS: Readonly<Record<Position, Cuts | null>> = {
  TOP: [8.2, 7.1, 6.1, 5.2],
  JUNGLE: [7.4, 6.3, 5.5, 4.6],
  MIDDLE: [7.9, 6.6, 5.7, 4.8],
  BOTTOM: [9.3, 8.4, 7.5, 6.6],
  UTILITY: null,
};
export const FARM_START_MIN = 15;
/** 20분 미만 게임은 중후반 파밍을 매기지 않음 */
export const FARM_MIN_GAME_SEC = 1200;
/** 6-1 평소 시야 (분당 점수) */
export const NORMAL_VISION_CUTS: Readonly<Record<Position, Cuts>> = {
  TOP: [0.51, 0.38, 0.31, 0.23],
  JUNGLE: [0.88, 0.65, 0.5, 0.35],
  MIDDLE: [0.64, 0.49, 0.37, 0.28],
  BOTTOM: [0.66, 0.52, 0.42, 0.29],
  UTILITY: [1.98, 1.62, 1.33, 1.05],
};

// ---------- 공통 도우미 ----------

/** 하한 이상이면 그 등급 */
export function gradeByCuts(value: number, cuts: Cuts): Grade {
  if (value >= cuts[0]) return 'A';
  if (value >= cuts[1]) return 'B';
  if (value >= cuts[2]) return 'C';
  if (value >= cuts[3]) return 'D';
  return 'E';
}

/** 5-2 딜 차이(%p) → 등급 */
export function gradeDamageDiff(diff: number): Grade {
  if (diff >= DAMAGE_DIFF.a) return 'A';
  if (diff >= DAMAGE_DIFF.b) return 'B';
  if (diff > DAMAGE_DIFF.d) return 'C';
  if (diff > DAMAGE_DIFF.e) return 'D';
  return 'E';
}

/** 등급 점수 평균(0~1)을 가장 가까운 등급으로. 정확히 중간이면 높은 등급 (예: C·D 평균 37.5% → C) */
export function gradeFromPoint(point: number): Grade {
  let best: Grade = 'E';
  let bestDist = Infinity;
  for (const g of GRADES) {
    const d = Math.abs(GRADE_POINT[g] - point);
    if (d < bestDist - 1e-9) {
      best = g;
      bestDist = d;
    }
  }
  return best;
}
