// 판정 엔진 입력·출력 타입 (ai_spec 1단계 B-1)
// 엔진이 읽는 Riot 필드만 둔다. 기존 riot/types.ts는 수정하지 않고, 구조가 같아 그대로 넘길 수 있다.

/** Riot teamPosition 5개 */
export type Position = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY';

/** 유형 10개 (feedback_design 7장) */
export type Role =
  | 'TOP_TANK'
  | 'TOP_DAMAGE'
  | 'JUNGLE_TANK'
  | 'JUNGLE_DAMAGE'
  | 'MID_TANK'
  | 'MID_DAMAGE'
  | 'ADC'
  | 'SUPPORT_TANK'
  | 'SUPPORT_DAMAGE'
  | 'SUPPORT_UTILITY';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';

// ---------- 입력 (Riot match-v5 / timeline 중 엔진이 쓰는 부분) ----------

export interface AnalysisParticipant {
  participantId: number;
  puuid: string;
  teamId: number;
  teamPosition: string;
  championId: number;
  championName?: string;
  win: boolean;
  damageDealtToTurrets?: number;
}

export interface AnalysisMatch {
  metadata: { matchId: string };
  info: {
    gameDuration: number;
    gameVersion?: string;
    queueId?: number;
    participants: AnalysisParticipant[];
  };
}

export interface ParticipantFrame {
  totalGold?: number;
  level?: number;
  minionsKilled?: number;
  jungleMinionsKilled?: number;
  damageStats?: { totalDamageDoneToChampions?: number };
}

export interface VictimDamage {
  participantId?: number;
  type?: string;
}

export interface TimelineEvent {
  type: string;
  timestamp: number;
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  victimDamageReceived?: VictimDamage[];
  creatorId?: number;
  wardType?: string;
  monsterType?: string;
  monsterSubType?: string;
  killerTeamId?: number;
  teamId?: number;
  buildingType?: string;
  laneType?: string;
  towerType?: string;
}

export interface TimelineFrame {
  timestamp?: number;
  events: TimelineEvent[];
  /** 키는 문자열 participantId("1"~"10") */
  participantFrames?: Record<string, ParticipantFrame>;
}

export interface AnalysisTimeline {
  metadata?: { matchId?: string };
  info: { frames: TimelineFrame[] };
}

/** championId → Data Dragon tags (예: 235 → ['Support', 'Marksman']) */
export type ChampionTags = ReadonlyMap<number, readonly string[]>;

export interface AnalysisInput {
  match: AnalysisMatch;
  timeline: AnalysisTimeline;
  puuid: string;
  championTags: ChampionTags;
}

// ---------- 출력 ----------

export type FactValue = number | string | boolean | null | number[] | FactValue[];
export type Facts = Record<string, FactValue>;

export interface LaningItem {
  /** laning.gold | laning.level | laning.kda | laning.cs */
  id: string;
  me: number;
  enemy: number;
  diff: number;
  /** +1 / 0 / −1 */
  point: number;
  detail?: Facts;
}

export interface LaningResult {
  referenceSec: number;
  /** 'DEFAULT_15' | 'TURRET' | 'MIN_10' | 'JUNGLE_15' | 'GAME_END' */
  referenceReason: string;
  /** 기준 시점에 그 라인 1차 포탑이 깨진 시각(초). 없으면 null */
  laneTurretSec: number | null;
  opponent: { participantId: number; championId: number };
  items: LaningItem[];
  sum: number;
  verdict: '우세' | '열세' | '비슷';
  /** 기준 시점 전 내 데스 시각(초) */
  deathsBeforeReferenceSec: number[];
}

export interface SubjectResult {
  /** 예: fight.damage, macro.vision */
  id: string;
  weight: number;
  /** 매길 수 없으면 null */
  grade: Grade | null;
  /** 등급 점수 0~1 (딜처럼 구간 평균이면 중간값이 나올 수 있다) */
  gradePoint: number | null;
  /** weight × gradePoint */
  score: number | null;
  /** weight × (gradePoint − 0.5). 말할 순서에 쓴다 */
  impact: number | null;
  facts: Facts;
  /** grade가 null인 이유 */
  reason?: string;
}

export interface AreaResult {
  weights: Record<string, number>;
  subjects: SubjectResult[];
  /** Σscore ÷ Σ(매긴 과목 weight) × 100. 매긴 과목이 없으면 null */
  total: number | null;
  verdict: '잘함' | '보통' | '부족' | null;
}

export interface FollowUp {
  sec: number;
  kind: 'BUILDING' | 'MONSTER';
  /** 우리 팀이 얻었나 */
  ours: boolean;
  /** BUILDING: 'TOWER_BUILDING:BOT_LANE:OUTER_TURRET', MONSTER: 'DRAGON:WATER_DRAGON' */
  what: string;
}

export interface KeyMoment {
  startSec: number;
  endSec: number;
  kills: number;
  /** 우리 팀 킬 / 상대 팀 킬 */
  killsOurs: number;
  killsTheirs: number;
  playerInvolved: boolean;
  playerDied: boolean;
  /** 우리 팀 기준 팀 골드 차 (양수 = 우리가 앞섬) */
  goldDiffBefore: number;
  goldDiffAfter: number;
  /** goldDiffAfter − goldDiffBefore (우리 팀 기준) */
  swing: number;
  /** |after| − |before|. 양수 = 격차 벌어짐, 음수 = 좁혀짐 */
  gapChange: number;
  direction: 'widened' | 'narrowed';
  /** 골라진 이유: 'GOLD' (격차 변화 3,000 이상) | 'KILLS' (킬 5개 이상만 충족) */
  selectedBy: 'GOLD' | 'KILLS';
  followUps: FollowUp[];
}

export interface SpeakList {
  good: string[];
  bad: string[];
}

export interface Note {
  id: string;
  kind: 'interpretation';
  /** 5-4-1 표의 경우: TANK_WIN | TANK_LOSS | DEALER_LOSS | DEALER_WIN */
  key: string;
  text: string;
  facts: Facts;
}

export interface AnalysisResult {
  engineVersion: string;
  matchId: string;
  player: {
    participantId: number;
    championId: number;
    position: Position;
    role: Role;
    win: boolean;
    durationSec: number;
  };
  /** 상대 라이너가 없거나 기준 시점 스냅샷이 없으면 null */
  laning: LaningResult | null;
  laningUnavailableReason?: string;
  fight: AreaResult;
  macro: AreaResult;
  keyMoments: KeyMoment[];
  summary: {
    laning: LaningResult['verdict'] | null;
    fight: AreaResult['verdict'];
    macro: AreaResult['verdict'];
    keyMomentIndex: number | null;
  };
  speakOrder: { laning: SpeakList; fight: SpeakList; macro: SpeakList };
  notes: Note[];
  warnings: string[];
}
