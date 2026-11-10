// 장면 정보 (ai_spec Q2): 점수·등급·말할 순서와 무관한 문장 재료.
// 과목 판정(fight.ts·macro.ts)은 그대로 두고, 같은 싸움 묶기·창 규칙으로 "어느 장면이었나"만 다시 모은다.
// 과목마다 최대 3개, 그 과목을 말하는 방향(좋은 점이면 잘한 장면, 아니면 아쉬운 장면)에서 중요한 순.
import { wardPoints } from './fight.js';
import {
  addBuildingPoints,
  addKillPoints,
  championKills,
  groupKills,
  inAnyWindow,
  inWindow,
  mergeWindows,
  objectiveFights,
  type ObjectiveFight,
  type ObjectiveKill,
  type TeamPoints,
} from './fights.js';
import { FIGHT_BUILDING_TAIL_MS, OBJECTIVE_WINDOW_MS, VISION_OBJECTIVE_TYPES, VISION_WINDOW_MS } from './rules.js';
import { enemyTeam, isChampionKill, sec, type MatchContext } from './timeline.js';
import type {
  FightScene,
  LaningResult,
  MapRegion,
  ObjectiveScene,
  PlayScene,
  Scenes,
  SpeakList,
  TimelineEvent,
} from './types.js';

/** 과목마다 장면 최대 개수 */
export const SCENES_MAX = 3;

// ---------- 지역 ----------

/** 소환사의 협곡 좌표 기준값 (블루 기지 왼쪽 아래 (0,0), 레드 기지 오른쪽 위 약 (14800,14800)) */
const MAP = {
  /** 강 중심선: x + y ≈ 14800 */
  riverSum: 14_800,
  riverHalf: 1_400,
  /** 기지: 블루 x,y < 4300 / 레드 x,y > 10500 */
  blueBase: 4_300,
  redBase: 10_500,
  /** 라인 폭 */
  laneEdge: 2_000,
  laneFar: 12_800,
  corner: 3_300,
  cornerFar: 11_500,
  /** 미드: |x − y| < 1100 */
  midHalf: 1_100,
} as const;

type AbsSide = 'BLUE' | 'RED';

/** 좌표 → 지역 (내 팀 진영 기준). 좌표가 없으면 null */
export function regionOf(pos: { x: number; y: number } | undefined, myTeamId: number): MapRegion | null {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  const { x, y } = pos;
  const mine: AbsSide = myTeamId === 200 ? 'RED' : 'BLUE';
  const rel = (side: AbsSide): 'OUR' | 'ENEMY' => (side === mine ? 'OUR' : 'ENEMY');
  // 라인 반쪽: 강 중심선(x + y = 14800)보다 블루 쪽이면 블루 포탑 쪽
  const half: AbsSide = x + y < MAP.riverSum ? 'BLUE' : 'RED';
  const laneHalf = rel(half) === 'OUR' ? 'OURS' : 'THEIRS';

  if (x < MAP.blueBase && y < MAP.blueBase) return `${rel('BLUE')}_BASE`;
  if (x > MAP.redBase && y > MAP.redBase) return `${rel('RED')}_BASE`;
  const top = (x < MAP.laneEdge && y >= MAP.blueBase) || (y > MAP.laneFar && x <= MAP.redBase) || (x < MAP.corner && y > MAP.cornerFar);
  if (top) return `TOP_LANE_${laneHalf}`;
  const bot = (y < MAP.laneEdge && x >= MAP.blueBase) || (x > MAP.laneFar && y <= MAP.redBase) || (y < MAP.corner && x > MAP.cornerFar);
  if (bot) return `BOT_LANE_${laneHalf}`;
  if (Math.abs(x - y) < MAP.midHalf) return `MID_LANE_${laneHalf}`;
  const upper = y > x; // 화면 위쪽 = 탑 쪽
  if (Math.abs(x + y - MAP.riverSum) < MAP.riverHalf) return upper ? 'RIVER_TOP' : 'RIVER_BOT';
  return `${rel(half)}_JUNGLE_${upper ? 'TOP' : 'BOT'}`;
}

// ---------- 오브젝트 장면 ----------

function objectiveScenes(ctx: MatchContext, objectives: readonly ObjectiveKill[]): ObjectiveScene[] {
  const me = ctx.me.participantId;
  return objectives.map((o) => {
    let wardsPlaced = 0;
    let controlWards = 0;
    let wardKills = 0;
    for (const e of ctx.events) {
      if (e.timestamp < o.timestamp - VISION_WINDOW_MS || e.timestamp > o.timestamp) continue;
      if (e.type === 'WARD_PLACED' && e.creatorId === me && wardPoints(e, me) > 0) {
        wardsPlaced++;
        if (e.wardType === 'CONTROL_WARD') controlWards++;
      }
      if (e.type === 'WARD_KILL' && e.killerId === me) wardKills++;
    }
    return {
      sec: sec(o.timestamp),
      kind: o.kind,
      ours: o.killerTeamId === ctx.me.teamId,
      lastHitByMe: o.killerId === me,
      wardsPlaced,
      controlWards,
      wardKills,
    };
  });
}

const visionPoints = (s: ObjectiveScene) => s.wardsPlaced + 2 * s.controlWards + 2 * s.wardKills;

/** 교전 시야: 시야 창이 있는 오브젝트(용·바론·전령)만. 부족: 내 와드가 적은 순(상대가 잡은 것 먼저), 좋음: 많은 순 */
function sortVision(xs: ObjectiveScene[], good: boolean): ObjectiveScene[] {
  return [...xs].sort((a, b) =>
    good
      ? visionPoints(b) - visionPoints(a) || Number(b.ours) - Number(a.ours) || a.sec - b.sec
      : visionPoints(a) - visionPoints(b) || Number(a.ours) - Number(b.ours) || a.sec - b.sec,
  );
}

const OBJECTIVE_WEIGHT: Readonly<Record<string, number>> = { ELDER_DRAGON: 6, BARON: 5, SOUL_DRAGON: 4, RIFTHERALD: 3, DRAGON: 2, HORDE: 1 };

/** 교전 막타: 좋음 = 내가 막타 친 큰 오브젝트 먼저, 부족 = 상대가 잡은 큰 오브젝트 먼저 */
function sortObjective(xs: ObjectiveScene[], good: boolean): ObjectiveScene[] {
  const w = (s: ObjectiveScene) => OBJECTIVE_WEIGHT[s.kind] ?? 0;
  return [...xs].sort((a, b) =>
    good
      ? Number(b.lastHitByMe) - Number(a.lastHitByMe) || w(b) - w(a) || a.sec - b.sec
      : Number(a.ours) - Number(b.ours) || w(b) - w(a) || a.sec - b.sec,
  );
}

// ---------- 싸움 장면 ----------

function firstDeathOf(ctx: MatchContext, kills: readonly TimelineEvent[]): FightScene['firstDeath'] {
  const first = kills.find((k) => k.victimId !== undefined && ctx.players.has(k.victimId));
  if (!first) return 'NONE';
  if (first.victimId === ctx.me.participantId) return 'ME';
  return ctx.players.get(first.victimId!)!.teamId === ctx.me.teamId ? 'ALLY' : 'ENEMY';
}

function fightScene(
  ctx: MatchContext,
  kills: readonly TimelineEvent[],
  points: TeamPoints,
  startMs: number,
  endMs: number,
  objectives: { kind: string; ours: boolean }[],
): FightScene {
  const team = ctx.me.teamId;
  let killsOurs = 0;
  let killsTheirs = 0;
  for (const k of kills) {
    const v = k.victimId === undefined ? undefined : ctx.players.get(k.victimId);
    if (!v) continue;
    if (v.teamId === team) killsTheirs++;
    else killsOurs++;
  }
  return {
    startSec: sec(startMs),
    endSec: sec(endMs),
    objectives,
    killsOurs,
    killsTheirs,
    pointsOurs: points.get(team) ?? 0,
    pointsTheirs: points.get(enemyTeam(team)) ?? 0,
    firstDeath: firstDeathOf(ctx, kills),
    iDied: kills.some((k) => k.victimId === ctx.me.participantId),
    region: regionOf(kills[0]?.position, team),
  };
}

/** 교전 득실: 내가 참여한(킬·데스·어시스트) 오브젝트 싸움 */
function objectiveFightScenes(ctx: MatchContext, objectives: readonly ObjectiveKill[]): FightScene[] {
  const fights: ObjectiveFight[] = objectiveFights(ctx, objectives);
  return fights
    .filter((f) => f.involved.has(ctx.me.participantId))
    .map((f) => {
      const objs = objectives.filter((o) => inWindow(o.timestamp, f.window)).map((o) => ({ kind: o.kind, ours: o.killerTeamId === ctx.me.teamId }));
      const startMs = f.kills[0]?.timestamp ?? f.window.start;
      const endMs = f.kills[f.kills.length - 1]?.timestamp ?? f.window.end;
      return fightScene(ctx, f.kills, f.points, startMs, endMs, objs);
    });
}

/** 운영 득실: 오브젝트 창 밖 싸움 중 내가 참여한 것 (macro.ts outsideFights와 같은 묶기·득실) */
function outsideFightScenes(ctx: MatchContext, objectives: readonly ObjectiveKill[]): FightScene[] {
  const windows = mergeWindows(objectives.map((o) => o.timestamp));
  const kills = championKills(ctx.events).filter((k) => !inAnyWindow(k.timestamp, windows));
  const out: FightScene[] = [];
  for (const g of groupKills(kills)) {
    const involved = g.kills.some((k) => k.killerId === ctx.me.participantId || k.victimId === ctx.me.participantId || (k.assistingParticipantIds ?? []).includes(ctx.me.participantId));
    if (!involved) continue;
    const points: TeamPoints = new Map();
    for (const k of g.kills) addKillPoints(ctx, points, k);
    for (const e of ctx.events) {
      if (e.type !== 'BUILDING_KILL') continue;
      if (e.timestamp < g.startMs || e.timestamp > g.endMs + FIGHT_BUILDING_TAIL_MS) continue;
      if (inAnyWindow(e.timestamp, windows)) continue;
      addBuildingPoints(points, e);
    }
    out.push(fightScene(ctx, g.kills, points, g.startMs, g.endMs, []));
  }
  return out;
}

/** 좋음: 우리 팀 득실이 큰 싸움 먼저, 부족: 상대 득실이 큰 싸움(내가 먼저 죽은 것 먼저) */
function sortFights(xs: FightScene[], good: boolean): FightScene[] {
  const net = (f: FightScene) => f.pointsOurs - f.pointsTheirs;
  return [...xs].sort((a, b) =>
    good
      ? net(b) - net(a) || a.startSec - b.startSec
      : net(a) - net(b) || Number(b.firstDeath === 'ME') - Number(a.firstDeath === 'ME') || a.startSec - b.startSec,
  );
}

// ---------- 킬·데스 장면 ----------

function playScene(ctx: MatchContext, k: TimelineEvent, kind: PlayScene['kind']): PlayScene {
  const enemyIds = kind === 'DEATH' ? [k.killerId, ...(k.assistingParticipantIds ?? [])].filter((id): id is number => id !== undefined && ctx.players.get(id)?.teamId === enemyTeam(ctx.me.teamId)) : [];
  return {
    sec: sec(k.timestamp),
    kind,
    region: regionOf(k.position, ctx.me.teamId),
    enemies: kind === 'DEATH' ? enemyIds.length : 1,
    enemyJungler: enemyIds.some((id) => ctx.players.get(id)?.position === 'JUNGLE'),
  };
}

/** 단독 킬·데스: 오브젝트 창 밖, 킬 1개로 끝난 싸움에서 내가 킬러거나 피해자 */
function soloScenes(ctx: MatchContext, objectives: readonly ObjectiveKill[]): PlayScene[] {
  const windows = mergeWindows(objectives.map((o) => o.timestamp));
  const kills = championKills(ctx.events).filter((k) => !inAnyWindow(k.timestamp, windows));
  const out: PlayScene[] = [];
  for (const g of groupKills(kills)) {
    if (g.kills.length !== 1) continue;
    const k = g.kills[0]!;
    if (k.killerId === ctx.me.participantId) out.push(playScene(ctx, k, 'KILL'));
    else if (k.victimId === ctx.me.participantId) out.push(playScene(ctx, k, 'DEATH'));
  }
  return out;
}

function sortSolo(xs: PlayScene[], good: boolean): PlayScene[] {
  const want: PlayScene['kind'] = good ? 'KILL' : 'DEATH';
  return [...xs].sort((a, b) => Number(b.kind === want) - Number(a.kind === want) || a.sec - b.sec);
}

function laningDeathScenes(ctx: MatchContext, laning: LaningResult | null): PlayScene[] {
  if (!laning) return [];
  const until = laning.referenceSec * 1000;
  return ctx.events
    .filter((e) => isChampionKill(e) && e.victimId === ctx.me.participantId && e.timestamp <= until)
    .map((e) => playScene(ctx, e, 'DEATH'));
}

// ---------- 모으기 ----------

export function buildScenes(
  ctx: MatchContext,
  objectives: readonly ObjectiveKill[],
  laning: LaningResult | null,
  speak: { fight: SpeakList; macro: SpeakList },
): Scenes {
  const good = (area: 'fight' | 'macro', id: string) => speak[area].good.includes(id);
  const all = objectiveScenes(ctx, objectives);
  // 교전 시야 과목과 같은 오브젝트(용·바론·전령)만
  const vision = all.filter((_, i) => VISION_OBJECTIVE_TYPES.includes(objectives[i]!.monsterType));
  return {
    fightWindowSec: OBJECTIVE_WINDOW_MS / 1000,
    visionWindowSec: VISION_WINDOW_MS / 1000,
    fightVision: sortVision(vision, good('fight', 'fight.vision')).slice(0, SCENES_MAX),
    fightObjective: sortObjective(all, good('fight', 'fight.objective')).slice(0, SCENES_MAX),
    fightAdvantage: sortFights(objectiveFightScenes(ctx, objectives), good('fight', 'fight.advantage')).slice(0, SCENES_MAX),
    macroAdvantage: sortFights(outsideFightScenes(ctx, objectives), good('macro', 'macro.advantage')).slice(0, SCENES_MAX),
    macroSolo: sortSolo(soloScenes(ctx, objectives), good('macro', 'macro.solo')).slice(0, SCENES_MAX),
    laningDeaths: laningDeathScenes(ctx, laning).slice(0, SCENES_MAX),
  };
}
