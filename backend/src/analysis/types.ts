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
  /** 게임 전체 챔피언 대상 딜 (Q6 P1 팀 딜 순위, 확정 값). 없으면 마지막 프레임 누적 값을 쓴다 */
  totalDamageDealtToChampions?: number;
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
  /** totalDamageTaken: 받은 피해 누적 (Q4 오브젝트 싸움 버티기, 1분 단위 추정) */
  damageStats?: { totalDamageDoneToChampions?: number; totalDamageTaken?: number };
  /** 상대에게 건 CC 시간 누적(ms) (Q4 이니시 추정 근거) */
  timeEnemySpentControlled?: number;
}

/** CHAMPION_KILL의 victimDamageReceived(받은 쪽: participantId = 가해자) / victimDamageDealt(준 쪽: participantId = 맞은 사람) 한 줄 */
export interface VictimDamage {
  participantId?: number;
  /** 피해를 준 쪽 이름 (챔피언이면 championName). Q6 1:1 킬: 화상 같은 지속 피해는 participantId가 다른 사람으로 찍히는 일이 있어 이름을 먼저 본다 */
  name?: string;
  /** OTHER(챔피언) | MINION | MONSTER | TOWER */
  type?: string;
  magicDamage?: number;
  physicalDamage?: number;
  trueDamage?: number;
}

export interface TimelineEvent {
  type: string;
  timestamp: number;
  killerId?: number;
  victimId?: number;
  assistingParticipantIds?: number[];
  victimDamageReceived?: VictimDamage[];
  /** 죽기 직전 피해자가 준 피해 (Q4 1:1 교환) */
  victimDamageDealt?: VictimDamage[];
  /** 킬 현상금 (킬러가 받은 골드, Q4 골드 분해) */
  bounty?: number;
  shutdownBounty?: number;
  /** LEVEL_UP: 레벨과 그 참가자 (Q4 6레벨 시각) */
  level?: number;
  participantId?: number;
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
  /** 골드·레벨·KDA·CS 비교 (Q4부터 판정이 아니라 원인 설명 재료) */
  items: LaningItem[];
  /** 기존 점수 합 (±1 합). Q4부터 판정에 쓰지 않고 원인 설명으로만 남긴다 (결정 1) */
  sum: number;
  /** 2-1 칸의 방향 (요약 판정어). Q4: 골드×레벨 표(cell)로 정한다 */
  verdict: '우세' | '열세' | '비슷';
  /** 2-1 골드×레벨 표의 칸 (Q4 라인전 판정) */
  cell: LaningCell;
  /** 1장 골드 분해 + 원인 2개 (Q4) */
  growth: LaningGrowth;
  /** 2-3 기준 시점 전 내 데스마다 유형 (Q4, 시각 순) */
  deaths: LaningDeath[];
  /** 2-2 라인 밖 관여 (Q4). 정글은 null */
  roam: LaningRoam | null;
  /** 6레벨을 찍은 시각(초). 기준 시점 전에 못 찍었으면 null (Q4) */
  levelSix: { meSec: number | null; enemySec: number | null };
  /** 기준 시점 전 내 데스 시각(초) */
  deathsBeforeReferenceSec: number[];
}

// ---------- 라인전 해석 (Q4, ai_spec Q4 1·2장) ----------

export type Trend = 'AHEAD' | 'EVEN' | 'BEHIND';

/**
 * 2-1 골드×레벨 표의 칸. 골드 "같음"(경계 rules.ts LANING_GROWTH.goldEvenBand) 줄은 레벨만으로 판단한다.
 * LEAD 라인전 우위 · GOLD_LEAD 우위(골드로 앞섬) · GAP_COVERED 성장 격차를 잘 따라감 ·
 * BASICS_KEPT 기본기는 잘 따라감 · XP_KEPT_GOLD_LOST 경험치는 따라갔지만 골드를 내줌 · LOST 라인전 패배 ·
 * LEVEL_LEAD / EVEN / LEVEL_BEHIND 골드가 같을 때 레벨로
 */
export type LaningCellId = 'LEAD' | 'GOLD_LEAD' | 'GAP_COVERED' | 'LEVEL_LEAD' | 'EVEN' | 'LEVEL_BEHIND' | 'BASICS_KEPT' | 'XP_KEPT_GOLD_LOST' | 'LOST';

export interface LaningCell {
  id: LaningCellId;
  gold: Trend;
  level: Trend;
  /** 표의 칸 이름 */
  label: string;
  verdict: '우세' | '열세' | '비슷';
}

/** 나 / 상대 라이너 */
export interface Pair {
  me: number;
  enemy: number;
}

/** 골드 차 원인 (1장). killGold·cs·plates = 골드 쪽, deaths·outOfLane = 레벨 쪽 */
export type LaningCauseId = 'killGold' | 'cs' | 'plates' | 'deaths' | 'outOfLane';

export interface LaningCause {
  id: LaningCauseId;
  me: number;
  enemy: number;
  /** 순위용 값: 골드 쪽 = 어림 골드(나 기준, 양수면 내게 유리), 레벨 쪽 = 개수 차(나 기준) */
  weight: number;
  favors: 'ME' | 'ENEMY';
}

export interface LaningGrowth {
  cs: Pair;
  kills: Pair;
  assists: Pair;
  /** 킬러 기준 킬 현상금 합 (bounty + shutdownBounty) */
  killBounty: Pair;
  /** 그 사람의 데스로 상대 팀이 얻은 현상금 합 (③) */
  deathBounty: Pair;
  /** 깬 포탑 방패 (TURRET_PLATE_DESTROYED killerId) */
  plates: Pair;
  /** 깬 포탑 (BUILDING_KILL killerId) */
  turrets: Pair;
  deaths: Pair;
  /** 상대 라이너가 나를 잡은 킬 수 / 상대 라이너가 내 데스에 어시스트한 수 */
  enemyKillsOnMe: number;
  enemyAssistsOnMe: number;
  /** 2-2 라인 밖 관여 (정글은 0) */
  outOfLane: Pair;
  /** 원인 큰 순 최대 2개 (2-1 칸마다 고르는 쪽이 다름) */
  causes: LaningCause[];
}

/**
 * 2-3 데스 유형 (LEVEL6은 유형과 함께 붙는 표시).
 * Q5(C3): 정글은 따로 — JUNGLE_SOLO(상대 정글과 1:1) · OUTNUMBERED(상대 2명 이상, 수적 열세) · OTHER.
 * GANK·ROAM·DIVE·SOLO는 라이너만.
 */
export type LaningDeathType = 'SOLO' | 'GANK' | 'ROAM' | 'DIVE' | 'OTHER' | 'JUNGLE_SOLO' | 'OUTNUMBERED';

export interface LaningDeath {
  sec: number;
  type: LaningDeathType;
  region: MapRegion | null;
  /** 관여한 상대 챔피언(킬러·어시스트·받은 피해) participantId */
  enemies: number[];
  /** 관여한 상대 정글 participantId (갱). 없으면 null */
  enemyJunglerId: number | null;
  /** 죽기 직전 내가 준 피해 / 상대 챔피언에게 받은 피해 합. 데이터 없으면 null */
  dealt: number | null;
  received: number | null;
  /** SOLO·JUNGLE_SOLO만: 준 피해 < 받은 피해 × 비율이면 true (일방적으로 당함), 아니면 false (교환 끝에 짐). 그 밖 null */
  oneSided: boolean | null;
  /** 직전 60초 동안 내가 설치한 와드 수 */
  wardsBefore: number;
  /** 상대 라이너가 6레벨을 먼저 찍은 뒤 ~ 내가 6레벨을 찍고 60초 안의 데스 */
  levelSix: boolean;
  /** 이 데스로 상대가 얻은 현상금 */
  bounty: number;
}

/** 라인 밖 관여 하나 (킬·어시스트) */
export interface OutOfLane {
  sec: number;
  region: MapRegion | null;
}

export interface LaningRoam {
  me: OutOfLane[];
  enemy: OutOfLane[];
  /** 상대가 라인 밖 관여한 시각 ±60초 안에 내가 깬 방패 시각(초) */
  platesWhileAwaySec: number[];
  /** 상대가 라인 밖 관여한 1분 프레임들의 내 CS 증가 합 (1분 단위라 추정). 프레임이 없으면 null */
  csWhileAway: number | null;
  /** 차이(상대 − 나) ≥ 경계 → OPPONENT(상대 로밍 우위), ≤ −경계 → ME, 그 밖 EVEN */
  verdict: 'OPPONENT' | 'ME' | 'EVEN';
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
  /** 참가자 10명의 팀·포지션·챔피언 (Q4: 데스에 관여한 상대 이름을 문장에 쓰려고). puuid는 넣지 않는다 */
  participants: { participantId: number; teamId: number; position: Position; championId: number }[];
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

/** 조언 규칙 R1~R11 (Q3·Q4) + R12 (Q7, 오브젝트 싸움 내 기여 낮음, 해석만) + 칭찬 규칙 P1~P4 (Q6, 좋은 점 칸만, 행동 조언 없음) */
export type AdviceRuleId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8' | 'R9' | 'R10' | 'R11' | 'R12' | PraiseRuleId;

/** 칭찬 규칙 (Q6): P1 딜 캐리 · P2 1:1 킬 · P3 후반 영향력 · P4 오브젝트 싸움 기여 */
export type PraiseRuleId = 'P1' | 'P2' | 'P3' | 'P4';

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
  /** Q4 3장 "오래 버텼는가": 싸움 첫 킬 뒤 내가 죽은 초 (내가 첫 킬이면 0). 안 죽었으면 null (확정) */
  myDeathAfterFirstKillSec: number | null;
  /** Q4 3장 이니시 근거: 그 싸움 첫 킬에 내가 킬러·어시스트였나 (확정 사실, 이니시 해석은 추정) */
  inFirstKill: boolean;
  /** Q4 3장 이니시 근거: 싸움 첫 데스의 받은 피해 목록 첫 가해자가 나인가 (목록 순서가 시각 순이라는 보장이 없어 추정). 데이터 없으면 null */
  firstHitByMe: boolean | null;
  /** Q4 3장: 싸움이 걸친 1분 프레임들의 내 챔피언 딜·받은 피해(팀 내 비중 %)·건 CC 초. 1분 단위라 추정. 프레임이 없으면 null */
  frame: { damage: number; damageSharePct: number | null; taken: number; takenSharePct: number | null; ccSec: number | null } | null;
  /** Q4 4장: 싸움 전·후 팀 골드 차 (우리 팀 기준, 1분 단위). 프레임이 없으면 null */
  goldBefore: number | null;
  goldAfter: number | null;
  /** Q5(C1): 이 싸움 킬에 관여한(킬러·피해자·어시스트) 우리 팀 / 상대 팀 인원 */
  involvedOurs: number;
  involvedTheirs: number;
}

/** Q4 4장: 라인 밖(내 라인 지역·맞상대 밖)에서 낸 킬·어시스트·데스, 게임 전체 */
export interface RoamKda {
  me: { kills: number; assists: number; deaths: number };
  enemy: { kills: number; assists: number; deaths: number };
}

/** Q6: 1:1 킬 하나 — 킬러 = 나, 어시스트 없음, 피해자가 죽기 직전 받은 챔피언 피해(victimDamageReceived)의 출처가 나뿐 (미니언·포탑·몬스터 피해는 허용) */
export interface SoloKillScene {
  sec: number;
  victimId: number;
  region: MapRegion | null;
}

/** Q6: 우리 팀 5명 안 게임 전체 챔피언 딜 (확정 값) */
export interface TeamDamage {
  /** 1 = 팀에서 가장 많음 (같으면 같은 순위) */
  rank: number;
  damage: number;
  teamTotal: number;
  /** 팀 합 중 내 비중 (%, 소수 첫째 자리) */
  sharePct: number;
}

/**
 * Q7: 라인전 비교 시점까지 킬 관여(킬·어시스트) 하나와 그 킬이 어디서 났나.
 * VS_LANER = 죽은 사람이 맞상대 라이너(나 ↔ 상대 라이너), OUT_OF_LANE = 라인 밖(2-2, laning.roam과 같은 기준), IN_LANE = 그 밖(내 라인에 온 정글 등)
 */
export interface LaneInvolvementEvent {
  sec: number;
  kind: 'KILL' | 'ASSIST';
  where: 'VS_LANER' | 'OUT_OF_LANE' | 'IN_LANE';
  region: MapRegion | null;
}

/** Q7: 라인전 킬 관여 (나 · 상대 라이너, 시각 순). 정글이거나 상대 라이너가 없으면 null */
export interface LaneInvolvement {
  me: LaneInvolvementEvent[];
  enemy: LaneInvolvementEvent[];
}

/**
 * Q7: 내가 참여한 오브젝트 싸움(교전 득실 5-4와 같은 싸움들)에서 내 기여. 모두 확정 값(이벤트·킬 직전 피해 기록). 1분 단위 추정 값이 아니다.
 * 피해 출처는 1:1 킬과 같은 방법(이름 먼저, championSourceOf)이고, 잡은 상대 쪽(피해자 팀) 출처는 보지 않는다.
 */
export interface ObjectiveContribution {
  /** 내가 참여한 오브젝트 싸움 수 (fight.advantage facts.fights와 같음) */
  fights: number;
  /** 그 싸움들에서 우리 팀이 잡은 상대 챔피언 수 */
  teamKills: number;
  myKills: number;
  myAssists: number;
  /** 우리 팀 킬 중 내 관여(킬 + 어시스트) 비율 (%, 소수 첫째 자리). 우리 팀 킬이 0이면 null */
  involvementPct: number | null;
  /** 잡은 상대가 죽기 직전 받은 챔피언 피해(victimDamageReceived) 중 우리 팀 합 / 내 몫 */
  killedDamageTeam: number;
  killedDamageMine: number;
  /** 내 몫 비율 (%, 소수 첫째 자리). 우리 팀 합이 0이면 null */
  killedDamagePct: number | null;
  /** 내 킬로 우리 팀이 얻은 득실 점수 (5-4 킬 점수 = 죽은 상대의 포지션 점수 합) */
  myKillPoints: number;
  myDeaths: number;
  /** 내 데스로 상대 팀이 얻은 득실 점수 (내 포지션 점수 × 데스 수) */
  myDeathPoints: number;
  /** 그 싸움 창에서 내가 막타를 친 오브젝트 (시각 순) */
  lastHits: { sec: number; kind: string; points: number }[];
  /** 높음/낮음 (경계 rules.ts CONTRIBUTION, 최근 200판 분포). 우리 팀 킬이 경계 수보다 적으면 둘 다 null(판단 안 함) */
  involvementLevel: 'HIGH' | 'LOW' | 'MID' | null;
  killedDamageLevel: 'HIGH' | 'LOW' | 'MID' | null;
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
  /** Q4: 내가 참여한 오브젝트 싸움 전부 (시각 순, 자르지 않음). R10·버티기 근거 */
  objectiveFights: FightScene[];
  /** Q4 4장: 게임 전체 라인 밖 킬·어시스트·데스 (나 대 상대 라이너). 상대 라이너가 없거나 정글이면 null */
  roamKda: RoamKda | null;
  /** Q6: 게임 전체 1:1 킬 (시각 순). 운영 "단독 킬"(6-1, 킬 1개로 끝난 싸움)과 정의가 다르다. P2·P3 문장 근거 */
  soloKills: SoloKillScene[];
  /** Q6: 팀 안 챔피언 딜 순위·비중. 팀원 값이 하나라도 없으면 null. P1 근거 */
  teamDamage: TeamDamage | null;
  /** Q7: 라인전 킬 관여와 그 킬이 어디서 났나 (라인 밖 칸 문장). 정글이거나 상대 라이너가 없으면 null */
  laneInvolvement: LaneInvolvement | null;
  /** Q7: 내가 참여한 오브젝트 싸움에서 내 기여 (확정 값, P4·R12 근거). 그런 싸움이 없으면 null */
  objectiveContribution: ObjectiveContribution | null;
}
