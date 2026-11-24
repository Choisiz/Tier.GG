// 판정 규칙 상수. feedback_design.md의 표 하나 = 상수 하나. 경계값·비율의 유일한 출처다.
// 규칙이나 경계값을 바꾸면 ENGINE_VERSION을 올린다 (5단계 캐시 키에 들어간다).
import type { Grade, LaningCellId, Position, Role, Trend } from './types.js';

export const ENGINE_VERSION = '2026-11-24.1';

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
  /** 라인전 점수 합 +2 이상 우세, −2 이하 열세. Q4부터 판정에 쓰지 않는다(원인 설명용 합만 남김) */
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

// ---------- 3-1. 라인전 해석 (Q4, feedback_design 3-1~3-3) ----------
/**
 * 2-1 골드×레벨 표. goldEvenBand: 골드 차 절댓값이 이 값 이하면 "같음"(레벨만으로 판단).
 * csGold·assistGold·plateGold: 원인 순위를 정할 때만 쓰는 어림 골드(문장에는 개수로 쓴다). 값과 근거는 feedback_design 3-1.
 */
export const LANING_GROWTH = {
  /** 최근 200판 라이너 2,000명의 기준 시점 골드 차 10% 지점 161, ±150 안 9.2% (≈ 미니언 한 웨이브) */
  goldEvenBand: 150,
  /** 같은 200판 탑·미드·원딜 1,200명 회귀: 골드 차 − 킬 현상금 차 ≈ 24.1·CS 차 + 119.3·어시스트 차 + 65.9·방패 차 */
  csGold: 24,
  assistGold: 120,
  plateGold: 66,
} as const;

/** 2-1 표: [골드][레벨] → 칸 */
export const LANING_CELLS: Readonly<Record<Trend, Readonly<Record<Trend, LaningCellId>>>> = {
  AHEAD: { AHEAD: 'LEAD', EVEN: 'GOLD_LEAD', BEHIND: 'GAP_COVERED' },
  EVEN: { AHEAD: 'LEVEL_LEAD', EVEN: 'EVEN', BEHIND: 'LEVEL_BEHIND' },
  BEHIND: { AHEAD: 'BASICS_KEPT', EVEN: 'XP_KEPT_GOLD_LOST', BEHIND: 'LOST' },
};

/** 칸 이름과 요약 방향. [사용자] 칸 4개 + [추가] 칸(레벨 같음 2개, 골드 같음 3개) */
export const LANING_CELL_INFO: Readonly<Record<LaningCellId, { label: string; verdict: '우세' | '열세' | '비슷' }>> = {
  LEAD: { label: '라인전 우위', verdict: '우세' },
  GOLD_LEAD: { label: '골드로 앞선 우위', verdict: '우세' },
  GAP_COVERED: { label: '성장 격차를 잘 따라감', verdict: '비슷' },
  LEVEL_LEAD: { label: '골드는 비슷하고 레벨로 앞섬', verdict: '우세' },
  EVEN: { label: '골드와 레벨 모두 비슷', verdict: '비슷' },
  LEVEL_BEHIND: { label: '골드는 비슷하지만 레벨이 뒤짐', verdict: '열세' },
  BASICS_KEPT: { label: '기본기는 잘 따라감', verdict: '비슷' },
  XP_KEPT_GOLD_LOST: { label: '경험치는 따라갔지만 골드를 내줌', verdict: '열세' },
  LOST: { label: '라인전 패배', verdict: '열세' },
};

/** 2-3: 1:1 데스에서 내가 준 피해가 받은 피해 × 이 비율 미만이면 "일방적으로 당함" (200판 1:1 데스 1,018개의 20% 지점 0.31, 1/3 미만 22.6%) */
export const ONE_SIDED_RATIO = 1 / 3;
/** 2-3 갱 데스: 직전 와드를 세는 창, 6레벨 데스: 내가 6레벨을 찍은 뒤 이 시간까지 */
export const LANING_DEATH_WARD_WINDOW_MS = 60_000;
export const LEVEL_SIX_AFTER_MS = 60_000;
/** 2-2: 라인 밖 관여 차이(상대 − 나)가 이 값 이상이면 상대 로밍 우위 (200판 라이너 1,600명: 차이 0이 41%, 1 이상이 한쪽 30%, 2 이상이면 14%) */
export const ROAM_DIFF = 1;
/** 2-2: 상대가 라인 밖 관여한 시각 ±이 시간 안의 내 방패를 "비운 동안 얻은 것"으로 센다 */
export const ROAM_PLATE_WINDOW_MS = 60_000;
/** 3장 R10: 딜러가 싸움 첫 킬 뒤 이 초 안에 죽으면 "오래 버티지 못함" (200판 딜러 데스 2,986개: 0초(첫 킬 본인) 30%, 그 뒤 초마다 약 1.5%로 고르게 줄어듦, 10초 안 48%) */
export const SURVIVE_SEC = 10;
/** Q5(C1) R10: 양 팀 각각 이 인원 이상이 킬에 관여한 싸움만 (라인전 1:1·2:1 데스가 오브젝트 창에 걸린 것을 빼려고) */
export const SURVIVE_MIN_INVOLVED = 2;

// ---------- 칭찬 규칙 (Q6, feedback_design 8-2) ----------
/**
 * P1~P4 경계. 근거는 최근 200판(2,000명) 분포 (feedback_design 8-2, results/2026-11-22.q6.thresholds.json).
 * 칭찬 근거는 확정 값만: 게임 끝 챔피언 딜, 구간 딜 비중(5-2와 같은 누적 스냅샷), 킬 직전 피해 출처, 오브젝트 싸움 득실.
 */
export const PRAISE = {
  /** P1: 팀 챔피언 딜 1위이고 어떤 구간 딜 비중이 기대치 + 이 값(%p) 이상. 팀 딜 1위 400명의 "가장 높은 구간 차이" 20% 지점 8.51 → 8 (1위의 81.8%, 전체의 16.4%) */
  carryDiff: 8,
  /** P2: 1:1 킬 이 수 이상 (사용자 결정 2026-11-24: 2 → 3. 200판에서 2면 31.9%, 3이면 16.7% 발동) */
  soloKillsMin: 3,
  /** P3: 후반 = 이 초 이후. 딜 구간 경계(5-2 30분 이후)와 같고, 200판 게임 길이 60% 지점 29.5분 · 30분 넘긴 판 36.5% · 1:1 킬의 3.7%만 30분 이후 */
  lateSec: 1800,
  /** P3 운영: 후반 1:1 킬 이 수 이상 (계획 값. 200판에서 0.9%) */
  lateSoloKillsMin: 2,
  /** P3 교전: 30분 이후 구간 딜 비중이 세 구간 중 가장 높고 기대치 + 이 값(%p) 이상 = 그 구간 딜 등급 A (5-2 DAMAGE_DIFF.a, 새 경계값 아님) */
  lateDiff: 6,
  /** P4: 오브젝트 싸움 득실 등급 A이고 참여한 싸움 이 수 이상 (계획 값. 200판에서 12.3%) */
  objectiveFightsMin: 3,
} as const;

// ---------- 오브젝트 싸움 내 기여 (Q7, feedback_design 8-3) ----------
/** Q7: 오브젝트 싸움 득실 등급 → 두 팀 점수 결과 말 (5-4 등급 경계 그대로: A 크게 이김 · B 이김 · C 비슷 · D 짐 · E 크게 짐). 문장 재료만 */
export const ADVANTAGE_OUTCOME: Readonly<Record<Grade, string>> = { A: '크게 이김', B: '이김', C: '비슷함', D: '짐', E: '크게 짐' };

/**
 * 내가 참여한 오브젝트 싸움에서 내 기여의 높음/낮음 경계 (확정 값만, scenes.objectiveContribution). 값 이상 = 높음, 값 이하 = 낮음.
 * 근거: 최근 솔로랭크 200판·1,959명 중 참여한 오브젝트 싸움 3번 이상 + 그 싸움들의 우리 팀 킬 4개 이상인 1,326명의
 * 20% / 80% 지점 (feedback_design 8-3, results/2026-11-24.q7.thresholds.json). 칭찬(P4)·부족한 점(R12) 문장 근거로만 쓰고 판정에는 쓰지 않는다.
 */
export const CONTRIBUTION = {
  /** 우리 팀 킬이 이 수보다 적으면 높음/낮음을 판단하지 않는다 (비율이 25%p 단위로 흔들림. 200판 우리 팀 킬 20% 지점 3) */
  minTeamKills: 4,
  /** ① 우리 팀 킬 중 내 관여(킬 + 어시스트) 비율(%), 포지션별 (탑은 낮고 서폿은 높아 한 값이면 탑은 늘 낮음·서폿은 늘 높음) */
  involvement: {
    TOP: { high: 66.7, low: 33.3 },
    JUNGLE: { high: 80, low: 44.4 },
    MIDDLE: { high: 72.7, low: 40 },
    BOTTOM: { high: 76.9, low: 42.9 },
    UTILITY: { high: 81.8, low: 50 },
  } as Readonly<Record<Position, { high: number; low: number }>>,
  /**
   * ② 잡은 상대가 죽기 직전 받은 챔피언 피해 중 내 몫(%), 유형 묶음별 (딜러 990명 · 탱커 66명 · 딜서폿 88명 · 탱·유틸서폿 182명).
   * 탱커 3유형·탱/유틸 서폿은 표본이 작아 묶었다
   */
  killedDamage: {
    ADC: { high: 40.2, low: 16 },
    MID_DAMAGE: { high: 40.2, low: 16 },
    TOP_DAMAGE: { high: 40.2, low: 16 },
    JUNGLE_DAMAGE: { high: 40.2, low: 16 },
    TOP_TANK: { high: 31.5, low: 12.8 },
    MID_TANK: { high: 31.5, low: 12.8 },
    JUNGLE_TANK: { high: 31.5, low: 12.8 },
    SUPPORT_DAMAGE: { high: 25.7, low: 9.2 },
    SUPPORT_TANK: { high: 12.8, low: 3.4 },
    SUPPORT_UTILITY: { high: 12.8, low: 3.4 },
  } as Readonly<Record<Role, { high: number; low: number }>>,
} as const;

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
