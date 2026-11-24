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
import { CONTRIBUTION, FIGHT_BUILDING_TAIL_MS, KEY_MOMENT, KILL_POINTS, OBJECTIVE_WINDOW_MS, VISION_OBJECTIVE_TYPES, VISION_WINDOW_MS } from './rules.js';
import { damageToChampions, enemyTeam, isChampionKill, lastFrameIndex, participantsOf, pframe, round, sec, teamGoldDiff, type MatchContext, type Player } from './timeline.js';
import type {
  FightScene,
  LaneInvolvement,
  LaningResult,
  MapRegion,
  ObjectiveContribution,
  Position,
  ObjectiveScene,
  PlayScene,
  RoamKda,
  Scenes,
  SoloKillScene,
  SpeakList,
  TeamDamage,
  TimelineEvent,
  VictimDamage,
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

/** 오브젝트마다 처치 전 60초 동안 내 와드 (시각 순, 자르지 않음). advice R11도 쓴다 */
export function objectiveScenes(ctx: MatchContext, objectives: readonly ObjectiveKill[]): ObjectiveScene[] {
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

export const OBJECTIVE_WEIGHT: Readonly<Record<string, number>> = { ELDER_DRAGON: 6, BARON: 5, SOUL_DRAGON: 4, RIFTHERALD: 3, DRAGON: 2, HORDE: 1 };

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

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Q4 3장: 싸움이 걸친 1분 프레임(시작 분 ~ 끝 분 올림)의 내 딜·받은 피해·CC 증가와 팀 내 비중. 1분 단위라 추정.
 * 끝 분이 시작 분과 같으면 다음 분까지 본다.
 */
export function fightFrame(ctx: MatchContext, startMs: number, endMs: number): FightScene['frame'] {
  if (!ctx.hasFrames) return null;
  const last = lastFrameIndex(ctx);
  const a = Math.min(Math.floor(startMs / 60_000), last);
  const b = Math.min(Math.max(Math.ceil(endMs / 60_000), a + 1), last);
  if (b <= a) return null;
  const delta = (pid: number, get: (i: number) => number | undefined) => {
    const x = get(a);
    const y = get(b);
    return x === undefined || y === undefined ? undefined : y - x;
  };
  const dealt = (pid: number) => delta(pid, (i) => pframe(ctx, i, pid)?.damageStats?.totalDamageDoneToChampions);
  const taken = (pid: number) => delta(pid, (i) => pframe(ctx, i, pid)?.damageStats?.totalDamageTaken);
  const cc = (pid: number) => delta(pid, (i) => pframe(ctx, i, pid)?.timeEnemySpentControlled);
  const me = ctx.me.participantId;
  const myDealt = dealt(me);
  if (myDealt === undefined) return null;
  const team = [...ctx.players.values()].filter((p) => p.teamId === ctx.me.teamId);
  const teamSum = (f: (pid: number) => number | undefined) => team.reduce((s, p) => s + (f(p.participantId) ?? 0), 0);
  const share = (mine: number, total: number) => (total > 0 ? round1((mine / total) * 100) : null);
  const myTaken = taken(me) ?? 0;
  const myCc = cc(me);
  return {
    damage: myDealt,
    damageSharePct: share(myDealt, teamSum(dealt)),
    taken: myTaken,
    takenSharePct: share(myTaken, teamSum(taken)),
    ccSec: myCc === undefined ? null : round1(myCc / 1000),
  };
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
  const meId = ctx.me.participantId;
  let killsOurs = 0;
  let killsTheirs = 0;
  for (const k of kills) {
    const v = k.victimId === undefined ? undefined : ctx.players.get(k.victimId);
    if (!v) continue;
    if (v.teamId === team) killsTheirs++;
    else killsOurs++;
  }
  const champKills = kills.filter((k) => k.victimId !== undefined && ctx.players.has(k.victimId));
  const first = champKills[0];
  const myDeath = champKills.find((k) => k.victimId === meId);
  const received = first?.victimDamageReceived;
  const last = lastFrameIndex(ctx);
  const gold = (i: number) => (ctx.hasFrames ? (teamGoldDiff(ctx, Math.min(i, last), team) ?? null) : null);
  // Q5(C1): 킬에 관여한 인원 (킬러·피해자·어시스트), 팀별
  const involved = new Set(champKills.flatMap((k) => participantsOf(k)));
  const involvedCount = (ours: boolean) => [...involved].filter((id) => ctx.players.has(id) && (ctx.players.get(id)!.teamId === team) === ours).length;
  return {
    startSec: sec(startMs),
    endSec: sec(endMs),
    objectives,
    killsOurs,
    killsTheirs,
    pointsOurs: points.get(team) ?? 0,
    pointsTheirs: points.get(enemyTeam(team)) ?? 0,
    firstDeath: firstDeathOf(ctx, kills),
    iDied: kills.some((k) => k.victimId === meId),
    region: regionOf(kills[0]?.position, team),
    myDeathAfterFirstKillSec: myDeath && first ? round1((myDeath.timestamp - first.timestamp) / 1000) : null,
    inFirstKill: first ? [first.killerId, ...(first.assistingParticipantIds ?? [])].includes(meId) : false,
    firstHitByMe: received && received.length > 0 ? received[0]!.participantId === meId : null,
    frame: fightFrame(ctx, startMs, endMs),
    goldBefore: gold(Math.floor(startMs / 60_000)),
    goldAfter: gold(Math.ceil((endMs + KEY_MOMENT.afterMs) / 60_000)),
    involvedOurs: involvedCount(true),
    involvedTheirs: involvedCount(false),
  };
}

/** 교전 득실: 내가 참여한(킬·데스·어시스트) 오브젝트 싸움 (시각 순). advice R10도 쓴다 */
export function objectiveFightScenes(ctx: MatchContext, objectives: readonly ObjectiveKill[]): FightScene[] {
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

// ---------- 라인 밖 KDA (Q4 4장) ----------

const LANE_PREFIX: Readonly<Record<Position, string | null>> = { TOP: 'TOP_LANE', JUNGLE: null, MIDDLE: 'MID_LANE', BOTTOM: 'BOT_LANE', UTILITY: 'BOT_LANE' };

/**
 * 게임 전체에서 내 라인 밖(맞상대가 아닌 상대를 잡은 킬·어시스트, 내 라인 지역 밖 데스)의 킬·어시스트·데스, 나 대 상대 라이너.
 * 맞상대 = 상대 팀의 같은 라인 무리(바텀은 원딜·서폿). 라인 지역은 좌표로 본다(좌표가 없으면 라인 밖으로 보지 않음).
 */
export function roamKda(ctx: MatchContext, laning: LaningResult | null): RoamKda | null {
  if (!laning || ctx.me.position === 'JUNGLE') return null;
  const opp = ctx.players.get(laning.opponent.participantId);
  if (!opp) return null;
  const group = (p: Player): readonly string[] => (p.position === 'BOTTOM' || p.position === 'UTILITY' ? ['BOTTOM', 'UTILITY'] : [p.position]);
  const of = (p: Player) => {
    const matchup = new Set([...ctx.players.values()].filter((x) => x.teamId !== p.teamId && group(p).includes(x.position)).map((x) => x.participantId));
    const prefix = LANE_PREFIX[p.position];
    const outside = (e: TimelineEvent) => {
      const r = regionOf(e.position, p.teamId);
      return r !== null && prefix !== null && !r.startsWith(prefix);
    };
    let kills = 0;
    let assists = 0;
    let deaths = 0;
    for (const e of ctx.events) {
      if (!isChampionKill(e) || e.victimId === undefined) continue;
      if (e.victimId === p.participantId) {
        if (outside(e)) deaths++;
        continue;
      }
      if (!participantsOf(e).includes(p.participantId) || matchup.has(e.victimId) || ctx.players.get(e.victimId)?.teamId === p.teamId) continue;
      if (!outside(e)) continue;
      if (e.killerId === p.participantId) kills++;
      else assists++;
    }
    return { kills, assists, deaths };
  };
  return { me: of(ctx.me), enemy: of(opp) };
}

// ---------- 1:1 킬 · 팀 딜 순위 (Q6 칭찬 규칙 근거, 확정 값) ----------

/** victimDamageReceived 줄 중 챔피언이 아닌 피해 (미니언·포탑·몬스터) */
const NON_CHAMPION_DAMAGE: readonly string[] = ['MINION', 'MONSTER', 'TOWER'];

/**
 * 피해 한 줄을 준 챔피언의 participantId. 챔피언 피해가 아니면 null.
 * 이름(name = championName)을 먼저 본다: 화상 같은 지속 피해는 participantId가 다른 사람으로 찍히는 일이 있다
 * (채점한 아리 판 33:26 다이애나 킬: 이름 "Ahri"·participantId 2). 이름이 이 판의 챔피언이 아니면 participantId.
 */
export function championSourceOf(ctx: MatchContext, d: VictimDamage): number | null {
  if (d.type !== undefined && NON_CHAMPION_DAMAGE.includes(d.type)) return null;
  if (d.name) {
    for (const p of ctx.players.values()) if (p.raw.championName === d.name) return p.participantId;
  }
  return d.participantId !== undefined && ctx.players.has(d.participantId) ? d.participantId : null;
}

/**
 * Q6 1:1 킬 (게임 전체, 시각 순): 킬러 = 나, 어시스트 없음, 피해자가 죽기 직전 받은 챔피언 피해 중 우리 팀(피해자의 상대) 쪽 출처가 나뿐.
 * 미니언·포탑·몬스터 피해는 허용한다. 받은 피해 기록이 없거나 그 안에 내 피해가 없으면 세지 않는다(확인할 수 없음).
 * 최근 200판 2,000명에서 Riot challenges.soloKills와 93.2% 같고, 다르면 항상 적게 센다(feedback_design 8-2).
 */
export function soloKillScenes(ctx: MatchContext): SoloKillScene[] {
  const meId = ctx.me.participantId;
  const out: SoloKillScene[] = [];
  for (const e of ctx.events) {
    if (!isChampionKill(e) || e.killerId !== meId || e.victimId === undefined || (e.assistingParticipantIds ?? []).length > 0) continue;
    const victim = ctx.players.get(e.victimId);
    if (!victim || victim.teamId === ctx.me.teamId || !e.victimDamageReceived) continue;
    const sources = new Set<number>();
    for (const d of e.victimDamageReceived) {
      const id = championSourceOf(ctx, d);
      if (id !== null && ctx.players.get(id)!.teamId === ctx.me.teamId) sources.add(id);
    }
    if (sources.size !== 1 || !sources.has(meId)) continue;
    out.push({ sec: sec(e.timestamp), victimId: e.victimId, region: regionOf(e.position, ctx.me.teamId) });
  }
  return out;
}

/** Q6 팀 안 챔피언 딜: 게임 끝 값(match totalDamageDealtToChampions), 없으면 마지막 프레임 누적. 팀원 값이 하나라도 없으면 null */
export function teamDamageOf(ctx: MatchContext): TeamDamage | null {
  const last = lastFrameIndex(ctx);
  const mates = [...ctx.players.values()].filter((p) => p.teamId === ctx.me.teamId);
  const values = new Map<number, number>();
  for (const p of mates) {
    const v = p.raw.totalDamageDealtToChampions ?? (ctx.hasFrames ? damageToChampions(ctx, last, p.participantId) : undefined);
    if (v === undefined) return null;
    values.set(p.participantId, v);
  }
  const damage = values.get(ctx.me.participantId)!;
  const teamTotal = [...values.values()].reduce((a, b) => a + b, 0);
  if (teamTotal <= 0) return null;
  const rank = 1 + [...values.values()].filter((v) => v > damage).length;
  return { rank, damage, teamTotal, sharePct: round((100 * damage) / teamTotal, 1) };
}

// ---------- 오브젝트 싸움 내 기여 (Q7, 확정 값) ----------

const dmgOf = (d: VictimDamage): number => (d.magicDamage ?? 0) + (d.physicalDamage ?? 0) + (d.trueDamage ?? 0);

/** 값 → 높음/낮음/보통 (high 이상 HIGH, low 이하 LOW) */
export function contributionLevel(v: number | null, cut: { high: number; low: number }): 'HIGH' | 'LOW' | 'MID' | null {
  if (v === null) return null;
  return v >= cut.high ? 'HIGH' : v <= cut.low ? 'LOW' : 'MID';
}

/**
 * Q7(사용자 채점 2026-11-24 "내 기여를 더 확인할 수 없나"): 내가 참여한 오브젝트 싸움(5-4 득실과 같은 싸움들)에서
 * ① 우리 팀 킬 중 내 관여(킬·어시스트) ② 잡은 상대가 죽기 직전 받은 챔피언 피해 중 내 몫(victimDamageReceived, 1분 단위 추정 아님)
 * ③ 내 킬로 얻은 점수 대 내 데스로 내준 점수 ④ 오브젝트 막타. 피해 출처는 1:1 킬과 같은 방법(이름 먼저)이고 우리 팀 출처만 센다.
 * 그런 싸움이 없으면 null.
 */
export function objectiveContribution(ctx: MatchContext, objectives: readonly ObjectiveKill[]): ObjectiveContribution | null {
  const meId = ctx.me.participantId;
  const team = ctx.me.teamId;
  const fights = objectiveFights(ctx, objectives).filter((f) => f.involved.has(meId));
  if (fights.length === 0) return null;
  let teamKills = 0;
  let myKills = 0;
  let myAssists = 0;
  let killedDamageTeam = 0;
  let killedDamageMine = 0;
  let myKillPoints = 0;
  let myDeaths = 0;
  const lastHits: ObjectiveContribution['lastHits'] = [];
  for (const f of fights) {
    for (const k of f.kills) {
      const victim = k.victimId === undefined ? undefined : ctx.players.get(k.victimId);
      if (!victim) continue;
      if (victim.participantId === meId) myDeaths++;
      if (victim.teamId === team) continue;
      teamKills++;
      if (k.killerId === meId) {
        myKills++;
        myKillPoints += KILL_POINTS[victim.position];
      } else if ((k.assistingParticipantIds ?? []).includes(meId)) myAssists++;
      for (const d of k.victimDamageReceived ?? []) {
        const src = championSourceOf(ctx, d);
        if (src === null || ctx.players.get(src)!.teamId !== team) continue;
        const v = dmgOf(d);
        killedDamageTeam += v;
        if (src === meId) killedDamageMine += v;
      }
    }
    for (const o of objectives) if (inWindow(o.timestamp, f.window) && o.killerId === meId) lastHits.push({ sec: sec(o.timestamp), kind: o.kind, points: o.points });
  }
  const pct1 = (a: number, b: number) => (b > 0 ? round((100 * a) / b, 1) : null);
  const involvementPct = pct1(myKills + myAssists, teamKills);
  const killedDamagePct = pct1(killedDamageMine, killedDamageTeam);
  // 우리 팀 킬이 너무 적으면 비율이 흔들려 높음/낮음을 판단하지 않는다
  const judged = teamKills >= CONTRIBUTION.minTeamKills;
  return {
    fights: fights.length,
    teamKills,
    myKills,
    myAssists,
    involvementPct,
    killedDamageTeam,
    killedDamageMine,
    killedDamagePct,
    myKillPoints,
    myDeaths,
    myDeathPoints: KILL_POINTS[ctx.me.position] * myDeaths,
    lastHits: lastHits.sort((a, b) => a.sec - b.sec),
    involvementLevel: judged ? contributionLevel(involvementPct, CONTRIBUTION.involvement[ctx.me.position]) : null,
    killedDamageLevel: judged ? contributionLevel(killedDamagePct, CONTRIBUTION.killedDamage[ctx.me.role]) : null,
  };
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
  laneInvolvement: LaneInvolvement | null = null,
): Scenes {
  const good = (area: 'fight' | 'macro', id: string) => speak[area].good.includes(id);
  const all = objectiveScenes(ctx, objectives);
  const objFights = objectiveFightScenes(ctx, objectives);
  // 교전 시야 과목과 같은 오브젝트(용·바론·전령)만
  const vision = all.filter((_, i) => VISION_OBJECTIVE_TYPES.includes(objectives[i]!.monsterType));
  return {
    fightWindowSec: OBJECTIVE_WINDOW_MS / 1000,
    visionWindowSec: VISION_WINDOW_MS / 1000,
    fightVision: sortVision(vision, good('fight', 'fight.vision')).slice(0, SCENES_MAX),
    fightObjective: sortObjective(all, good('fight', 'fight.objective')).slice(0, SCENES_MAX),
    fightAdvantage: sortFights(objFights, good('fight', 'fight.advantage')).slice(0, SCENES_MAX),
    macroAdvantage: sortFights(outsideFightScenes(ctx, objectives), good('macro', 'macro.advantage')).slice(0, SCENES_MAX),
    macroSolo: sortSolo(soloScenes(ctx, objectives), good('macro', 'macro.solo')).slice(0, SCENES_MAX),
    laningDeaths: laningDeathScenes(ctx, laning).slice(0, SCENES_MAX),
    objectiveFights: objFights,
    roamKda: roamKda(ctx, laning),
    soloKills: soloKillScenes(ctx),
    teamDamage: teamDamageOf(ctx),
    laneInvolvement,
    objectiveContribution: objectiveContribution(ctx, objectives),
  };
}
