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
  /** 지도 좌표 (CHAMPION_KILL·ELITE_MONSTER_KILL 등). 장면 지역(Q2)에만 쓴다 */
  position?: { x: number; y: number };
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
  /** 장면 정보 (Q2). 점수·등급·말할 순서에 쓰지 않는 문장 재료 */
  scenes: Scenes;
  /** 조언 규칙표 (Q3). 발동한 규칙과 근거. 점수·등급·말할 순서에 쓰지 않는 문장 재료 */
  advice: AdviceResult;
  warnings: string[];
}

/** advice를 붙이기 전 판정 결과 */
export type JudgedResult = Omit<AnalysisResult, 'advice'>;

// ---------- 조언 규칙 (Q3, 점수 밖) ----------

export type AdviceRuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

/** 발동한 규칙 하나 */
export interface FiredRule {
  id: AdviceRuleId;
  /** 이 규칙이 붙는 과목 (칸의 subjectId) */
  subjectId: string;
  /** 이 규칙이 붙는 칸 방향 */
  kind: 'good' | 'bad';
  /** 숫자·글자 근거 (facts.ts가 rule.* fact로 옮긴다) */
  facts: Facts;
}

export interface AdviceResult {
  rules: FiredRule[];
  /** 상대 라이너 (R1 비교 대상). 같은 포지션 상대가 1명이 아니면 null */
  opponentParticipantId: number | null;
}

// ---------- 장면 (Q2, 점수 밖) ----------

/**
 * 지도 지역. 내 팀 진영 기준(블루 100 = 왼쪽 아래, 레드 200 = 오른쪽 위).
 * 위/아래는 화면 기준(위 = 탑 쪽, 아래 = 바텀 쪽). 라인은 가운데를 기준으로 우리 포탑 쪽/상대 포탑 쪽.
 */
export type MapRegion =
  | 'OUR_BASE'
  | 'ENEMY_BASE'
  | 'TOP_LANE_OURS'
  | 'TOP_LANE_THEIRS'
  | 'MID_LANE_OURS'
  | 'MID_LANE_THEIRS'
  | 'BOT_LANE_OURS'
  | 'BOT_LANE_THEIRS'
  | 'RIVER_TOP'
  | 'RIVER_BOT'
  | 'OUR_JUNGLE_TOP'
  | 'OUR_JUNGLE_BOT'
  | 'ENEMY_JUNGLE_TOP'
  | 'ENEMY_JUNGLE_BOT';

/** 오브젝트 하나 (교전 시야·막타 과목 장면) */
export interface ObjectiveScene {
  /** 처치 시각(초) */
  sec: number;
  /** BARON | DRAGON | SOUL_DRAGON | ELDER_DRAGON | RIFTHERALD | HORDE */
  kind: string;
  /** 우리 팀이 잡았나 */
  ours: boolean;
  /** 내가 막타를 쳤나 */
  lastHitByMe: boolean;
  /** 처치 전 60초 동안 내가 설치한 와드(시야 점수가 있는 와드, 제어 와드 포함) */
  wardsPlaced: number;
  /** 그중 제어 와드 */
  controlWards: number;
  /** 처치 전 60초 동안 내가 없앤 상대 와드 */
  wardKills: number;
}

/** 내가 참여한 싸움 하나 (교전·운영 득실 과목 장면) */
export interface FightScene {
  startSec: number;
  endSec: number;
  /** 싸움 창 안에서 잡힌 오브젝트 (오브젝트 밖 싸움은 빈 배열) */
  objectives: { kind: string; ours: boolean }[];
  killsOurs: number;
  killsTheirs: number;
  /** 득실 (킬·포탑·억제기·오브젝트 점수, 엔진 5-4와 같은 셈) */
  pointsOurs: number;
  pointsTheirs: number;
  /** 이 싸움에서 처음 죽은 사람: 나 / 우리 팀 다른 사람 / 상대 / 없음 */
  firstDeath: 'ME' | 'ALLY' | 'ENEMY' | 'NONE';
  iDied: boolean;
  /** 첫 킬 위치. 좌표가 없으면 null */
  region: MapRegion | null;
}

/** 킬·데스 하나 (단독 킬·데스, 라인전 데스 장면) */
export interface PlayScene {
  sec: number;
  kind: 'KILL' | 'DEATH';
  region: MapRegion | null;
  /** 데스: 나를 잡는 데 관여한 상대 수(킬러 + 어시스트), 킬: 내가 잡은 상대 1 */
  enemies: number;
  /** 데스에 상대 정글이 관여했나 (킬은 false) */
  enemyJungler: boolean;
}

/** 과목별 장면. 과목마다 최대 3개, 그 과목을 말하는 방향(좋은 점/부족한 점)에서 중요한 순 */
export interface Scenes {
  /** 오브젝트 처치 앞뒤 40초 (교전 창 길이 설명용) */
  fightWindowSec: number;
  /** 오브젝트 전 시야 창 (60초) */
  visionWindowSec: number;
  fightVision: ObjectiveScene[];
  fightObjective: ObjectiveScene[];
  fightAdvantage: FightScene[];
  macroAdvantage: FightScene[];
  macroSolo: PlayScene[];
  /** 라인전 비교 시점 전 내 데스 (시각 순) */
  laningDeaths: PlayScene[];
}
