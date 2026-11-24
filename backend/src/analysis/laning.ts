// 3장 라인전: 기준 시점에 상대 라이너와 비교.
// Q4(2026-11-19, 결정 1): 판정 = 2-1 골드×레벨 표(cell). 기존 ±1 점수 합(sum)은 판정에서 빠지고 원인 설명으로만 남는다.
// 더해서 1장 골드 분해(원인 2개), 2-2 라인 밖 관여(로밍), 2-3 데스 유형을 코드가 정한다. LLM은 문장만 쓴다.
import { wardPoints } from './fight.js';
import {
  LANE_OF_POSITION,
  LANING,
  LANING_CELL_INFO,
  LANING_CELLS,
  LANING_CS_POSITIONS,
  LANING_DEATH_WARD_WINDOW_MS,
  LANING_GROWTH,
  LEVEL_SIX_AFTER_MS,
  ONE_SIDED_RATIO,
  ROAM_DIFF,
  ROAM_PLATE_WINDOW_MS,
} from './rules.js';
import { regionOf } from './scenes.js';
import { cs, lastFrameIndex, pframe, sec, type MatchContext, type Player } from './timeline.js';
import type {
  LaneInvolvement,
  LaneInvolvementEvent,
  LaningCause,
  LaningCell,
  LaningDeath,
  LaningGrowth,
  LaningItem,
  LaningResult,
  LaningRoam,
  OutOfLane,
  Position,
  TimelineEvent,
  Trend,
  VictimDamage,
} from './types.js';

export type LaningOutcome = { result: LaningResult } | { result: null; reason: string };

const sign = (d: number): number => (d > 0 ? 1 : d < 0 ? -1 : 0);

/** 그 라인 1차(OUTER) 포탑이 처음 깨진 시각(ms). 어느 팀 포탑이든 먼저 깨진 것 */
export function firstLaneTurretMs(ctx: MatchContext, lane: string): number | null {
  const e = ctx.events.find((x) => x.type === 'BUILDING_KILL' && x.towerType === 'OUTER_TURRET' && x.laneType === lane);
  return e ? e.timestamp : null;
}

/**
 * 기준 시점(초): min(15분, 그 라인 1차 포탑), 최소 10분. 서폿은 바텀, 정글은 15분 고정.
 * 게임이 기준 시점보다 먼저 끝나면 마지막 정각 분 스냅샷으로 줄인다(10분 미만이면 판정 불가).
 */
export function referencePoint(
  ctx: MatchContext,
  me: Player,
): { refSec: number; reason: string; turretSec: number | null } | null {
  const lane = LANE_OF_POSITION[me.position];
  const turretMs = lane ? firstLaneTurretMs(ctx, lane) : null;
  let refSec: number = LANING.defaultSec;
  let reason = me.position === 'JUNGLE' ? 'JUNGLE_15' : 'DEFAULT_15';
  if (turretMs !== null && turretMs / 1000 < refSec) {
    refSec = Math.max(LANING.minSec, turretMs / 1000);
    reason = turretMs / 1000 < LANING.minSec ? 'MIN_10' : 'TURRET';
  }
  // 정각 분 스냅샷(마지막 프레임은 게임 끝이라 제외)
  const lastWholeMinute = Math.max(0, lastFrameIndex(ctx) - 1);
  if (Math.floor(refSec / 60) > lastWholeMinute) {
    if (lastWholeMinute * 60 < LANING.minSec) return null;
    refSec = lastWholeMinute * 60;
    reason = 'GAME_END';
  }
  return { refSec, reason, turretSec: turretMs === null ? null : sec(turretMs) };
}

function kda(ctx: MatchContext, pid: number, untilMs: number): [number, number, number] {
  let k = 0;
  let d = 0;
  let a = 0;
  for (const e of ctx.events) {
    if (e.type !== 'CHAMPION_KILL' || e.timestamp > untilMs) continue;
    if (e.killerId === pid) k++;
    if (e.victimId === pid) d++;
    if (e.assistingParticipantIds?.includes(pid)) a++;
  }
  return [k, d, a];
}

// ---------- 2-1. 골드×레벨 표 ----------

/** 골드 차 → 앞섬/같음/뒤짐 (같음 = |차| ≤ goldEvenBand) */
export function goldTrend(diff: number, band: number = LANING_GROWTH.goldEvenBand): Trend {
  if (Math.abs(diff) <= band) return 'EVEN';
  return diff > 0 ? 'AHEAD' : 'BEHIND';
}

/** 레벨 차 → 앞섬/같음/뒤짐 (레벨은 정수라 0이면 같음) */
export function levelTrend(diff: number): Trend {
  return diff > 0 ? 'AHEAD' : diff < 0 ? 'BEHIND' : 'EVEN';
}

export function laningCell(goldDiff: number, levelDiff: number): LaningCell {
  const gold = goldTrend(goldDiff);
  const level = levelTrend(levelDiff);
  const id = LANING_CELLS[gold][level];
  return { id, gold, level, ...LANING_CELL_INFO[id] };
}

// ---------- 라인 짝·라인 지역 ----------

/** 같은 라인 무리: 바텀은 원딜·서폿 둘, 그 밖은 자기 포지션 */
const laneGroup = (p: Position): readonly Position[] => (p === 'BOTTOM' || p === 'UTILITY' ? ['BOTTOM', 'UTILITY'] : [p]);

/** 지역 이름 앞부분 (regionOf 결과가 이 말로 시작하면 그 라인) */
const LANE_REGION_PREFIX: Readonly<Record<Position, string | null>> = {
  TOP: 'TOP_LANE',
  JUNGLE: null,
  MIDDLE: 'MID_LANE',
  BOTTOM: 'BOT_LANE',
  UTILITY: 'BOT_LANE',
};

/** pid의 맞상대(상대 팀의 같은 라인 무리) */
function matchupOf(ctx: MatchContext, p: Player): Set<number> {
  const group = laneGroup(p.position);
  return new Set([...ctx.players.values()].filter((x) => x.teamId !== p.teamId && group.includes(x.position)).map((x) => x.participantId));
}

/** 이벤트 위치가 p의 라인 지역인가 (좌표가 없거나 정글이면 false) */
function inOwnLane(e: TimelineEvent, p: Player): boolean {
  const prefix = LANE_REGION_PREFIX[p.position];
  if (!prefix) return false;
  const r = regionOf(e.position, p.teamId);
  return r !== null && r.startsWith(prefix);
}

const killParticipants = (e: TimelineEvent): number[] => [...(e.killerId !== undefined ? [e.killerId] : []), ...(e.assistingParticipantIds ?? [])];

/**
 * 2-2 라인 밖 관여: p가 킬·어시스트한 CHAMPION_KILL 중 죽은 사람이 p의 맞상대(바텀은 듀오)가 아니고,
 * 그 킬 위치가 p의 라인 지역도 아닌 것 (내 라인에 온 상대 정글을 잡은 것은 라인 밖이 아니다).
 */
export function outOfLaneEvents(ctx: MatchContext, p: Player, fromMs: number, untilMs: number): TimelineEvent[] {
  if (p.position === 'JUNGLE') return [];
  const matchup = matchupOf(ctx, p);
  return ctx.events.filter(
    (e) =>
      e.type === 'CHAMPION_KILL' &&
      e.timestamp >= fromMs &&
      e.timestamp <= untilMs &&
      killParticipants(e).includes(p.participantId) &&
      e.victimId !== undefined &&
      ctx.players.get(e.victimId)?.teamId !== p.teamId &&
      !matchup.has(e.victimId) &&
      !inOwnLane(e, p),
  );
}

/**
 * Q7(사용자 채점 2026-11-24): 라인전 비교 시점까지 킬 관여(킬·어시스트) 하나하나가 어디서 났나. 점수 밖 문장 재료(scenes).
 * 라인 밖 문장이 "다른 라인·정글 싸움 나 2번, 상대 0번"만 쓰면 상대의 라인 안 킬(나를 잡은 킬)이 없던 것처럼 읽혀서,
 * 전체 킬 관여 → 그 킬이 어디서 났나(맞상대를 잡음 / 라인 밖 / 그 밖 라인 안) 순으로 쓰려고 모은다.
 * OUT_OF_LANE은 2-2(outOfLaneEvents)와 같은 기준이라 laning.roam 수와 같다. 정글이거나 라인전 비교가 없으면 null.
 */
export function laneInvolvementOf(ctx: MatchContext, laning: LaningResult | null): LaneInvolvement | null {
  if (!laning || ctx.me.position === 'JUNGLE') return null;
  const opp = ctx.players.get(laning.opponent.participantId);
  if (!opp) return null;
  const untilMs = laning.referenceSec * 1000;
  const of = (p: Player, laner: Player): LaneInvolvementEvent[] => {
    const out = new Set(outOfLaneEvents(ctx, p, 0, untilMs));
    return ctx.events
      .filter((e) => e.type === 'CHAMPION_KILL' && e.timestamp <= untilMs && e.victimId !== undefined && ctx.players.get(e.victimId)?.teamId !== p.teamId && killParticipants(e).includes(p.participantId))
      .map((e) => ({
        sec: sec(e.timestamp),
        kind: e.killerId === p.participantId ? ('KILL' as const) : ('ASSIST' as const),
        where: e.victimId === laner.participantId ? ('VS_LANER' as const) : out.has(e) ? ('OUT_OF_LANE' as const) : ('IN_LANE' as const),
        region: regionOf(e.position, ctx.me.teamId),
      }));
  };
  return { me: of(ctx.me, opp), enemy: of(opp, ctx.me) };
}

// ---------- 2-3. 데스 유형 ----------

const dmg = (x: VictimDamage): number => (x.magicDamage ?? 0) + (x.physicalDamage ?? 0) + (x.trueDamage ?? 0);

/** 6레벨을 처음 찍은 시각(ms). 없으면 null */
export function levelSixMs(ctx: MatchContext, pid: number): number | null {
  const e = ctx.events.find((x) => x.type === 'LEVEL_UP' && x.participantId === pid && (x.level ?? 0) >= 6);
  return e ? e.timestamp : null;
}

/**
 * 데스 하나의 유형 (우선순위 순): 갱(상대 정글 관여, 정글 본인 제외) → 로밍 당함(맞상대·정글 밖 상대 라이너) →
 * 다이브(우리 포탑 쪽 내 라인에서 상대 2명 이상, 추정) → 1:1(킬러 = 맞상대, 어시스트 없음) → 그 밖.
 * 정글(Q5 C3)은 수적 열세(상대 2명 이상) → 상대 정글과 1:1 → 그 밖.
 * 관여한 상대 = 킬러·어시스트·받은 피해(챔피언)의 상대 팀 참가자.
 */
export function classifyDeath(ctx: MatchContext, me: Player, e: TimelineEvent, opponentSixMs: number | null, mySixMs: number | null): LaningDeath {
  const isEnemy = (id: number | undefined): id is number => id !== undefined && ctx.players.get(id)?.teamId !== undefined && ctx.players.get(id)!.teamId !== me.teamId;
  const assists = (e.assistingParticipantIds ?? []).filter(isEnemy);
  const received = e.victimDamageReceived;
  const fromDamage = (received ?? []).map((x) => x.participantId).filter(isEnemy);
  const enemies = [...new Set([...(isEnemy(e.killerId) ? [e.killerId] : []), ...assists, ...fromDamage])].sort((a, b) => a - b);
  const matchup = matchupOf(ctx, me);
  const jungler = me.position === 'JUNGLE' ? undefined : enemies.find((id) => ctx.players.get(id)!.position === 'JUNGLE');
  const others = enemies.filter((id) => !matchup.has(id) && id !== jungler);
  const region = regionOf(e.position, me.teamId);
  const prefix = LANE_REGION_PREFIX[me.position];
  let type: LaningDeath['type'];
  if (me.position === 'JUNGLE') {
    // Q5(C3): 정글은 맞상대가 상대 정글이라 라이너 유형(갱·로밍 당함)이 맞지 않는다.
    // 상대 2명 이상 관여 → 수적 열세, 상대 정글 혼자(어시스트 없음) → 상대 정글과 1:1, 그 밖(라이너 혼자·포탑 등) → 그 밖
    if (enemies.length >= 2) type = 'OUTNUMBERED';
    else if (e.killerId !== undefined && matchup.has(e.killerId) && assists.length === 0) type = 'JUNGLE_SOLO';
    else type = 'OTHER';
  } else if (jungler !== undefined) type = 'GANK';
  else if (others.length > 0) type = 'ROAM';
  else if (prefix && region === `${prefix}_OURS` && enemies.length >= 2) type = 'DIVE';
  else if (e.killerId !== undefined && matchup.has(e.killerId) && assists.length === 0) type = 'SOLO';
  else type = 'OTHER';

  const dealtTotal = e.victimDamageDealt ? e.victimDamageDealt.reduce((s, x) => s + dmg(x), 0) : null;
  const receivedTotal = received ? received.filter((x) => isEnemy(x.participantId)).reduce((s, x) => s + dmg(x), 0) : null;
  const oneOnOne = type === 'SOLO' || type === 'JUNGLE_SOLO';
  const oneSided = oneOnOne && dealtTotal !== null && receivedTotal !== null ? dealtTotal < receivedTotal * ONE_SIDED_RATIO : null;
  const wardsBefore = ctx.events.filter(
    (w) => w.type === 'WARD_PLACED' && w.timestamp >= e.timestamp - LANING_DEATH_WARD_WINDOW_MS && w.timestamp <= e.timestamp && wardPoints(w, me.participantId) > 0,
  ).length;
  // 6레벨 차이: 상대가 먼저 6을 찍었고, 그 뒤 ~ 내가 6을 찍고 60초 안
  const sixFirst = opponentSixMs !== null && (mySixMs === null || opponentSixMs < mySixMs);
  const levelSix = sixFirst && e.timestamp >= opponentSixMs && (mySixMs === null || e.timestamp <= mySixMs + LEVEL_SIX_AFTER_MS);
  return {
    sec: sec(e.timestamp),
    type,
    region,
    enemies,
    enemyJunglerId: jungler ?? null,
    dealt: dealtTotal,
    received: receivedTotal,
    oneSided,
    wardsBefore,
    levelSix,
    bounty: (e.bounty ?? 0) + (e.shutdownBounty ?? 0),
  };
}

// ---------- 2-2. 로밍 ----------

function analyzeRoam(ctx: MatchContext, me: Player, opp: Player, untilMs: number): LaningRoam | null {
  if (me.position === 'JUNGLE') return null;
  const toScene = (e: TimelineEvent): OutOfLane => ({ sec: sec(e.timestamp), region: regionOf(e.position, me.teamId) });
  const mine = outOfLaneEvents(ctx, me, 0, untilMs);
  const theirs = outOfLaneEvents(ctx, opp, 0, untilMs);
  const plates = ctx.events.filter((e) => e.type === 'TURRET_PLATE_DESTROYED' && e.killerId === me.participantId && e.timestamp <= untilMs);
  const platesWhileAway = plates.filter((p) => theirs.some((t) => Math.abs(p.timestamp - t.timestamp) <= ROAM_PLATE_WINDOW_MS));
  // 상대가 비운 1분 프레임마다 내 CS 증가 (1분 단위라 추정)
  let csWhileAway: number | null = null;
  const minutes = [...new Set(theirs.map((t) => Math.floor(t.timestamp / 60_000)))];
  for (const m of minutes) {
    const a = cs(pframe(ctx, m, me.participantId));
    const b = cs(pframe(ctx, m + 1, me.participantId));
    if (a === undefined || b === undefined || m + 1 > lastFrameIndex(ctx)) continue;
    csWhileAway = (csWhileAway ?? 0) + Math.max(0, b - a);
  }
  const diff = theirs.length - mine.length;
  return {
    me: mine.map(toScene),
    enemy: theirs.map(toScene),
    platesWhileAwaySec: platesWhileAway.map((p) => sec(p.timestamp)),
    csWhileAway,
    verdict: diff >= ROAM_DIFF ? 'OPPONENT' : diff <= -ROAM_DIFF ? 'ME' : 'EVEN',
  };
}

// ---------- 1장. 골드 분해 ----------

function pairOf(f: (pid: number) => number, me: Player, opp: Player) {
  return { me: f(me.participantId), enemy: f(opp.participantId) };
}

/** 원인 순위: 골드 쪽은 어림 골드, 레벨 쪽은 개수 차. 큰 것부터 (같으면 표 순서) */
export function rankCauses(g: Omit<LaningGrowth, 'causes'>, cell: LaningCell): LaningCause[] {
  const mk = (id: LaningCause['id'], me: number, enemy: number, weight: number): LaningCause => ({ id, me, enemy, weight, favors: weight > 0 ? 'ME' : 'ENEMY' });
  const goldCauses = [
    mk('killGold', g.killBounty.me, g.killBounty.enemy, g.killBounty.me - g.killBounty.enemy + (g.assists.me - g.assists.enemy) * LANING_GROWTH.assistGold),
    mk('cs', g.cs.me, g.cs.enemy, (g.cs.me - g.cs.enemy) * LANING_GROWTH.csGold),
    mk('plates', g.plates.me, g.plates.enemy, (g.plates.me - g.plates.enemy) * LANING_GROWTH.plateGold),
  ];
  // 레벨 쪽: 데스가 많을수록, 라인을 비운 횟수가 많을수록 경험치를 잃는다 (나 기준 양수 = 내게 유리)
  const levelCauses = [mk('deaths', g.deaths.me, g.deaths.enemy, g.deaths.enemy - g.deaths.me), mk('outOfLane', g.outOfLane.me, g.outOfLane.enemy, g.outOfLane.enemy - g.outOfLane.me)];
  const byMagnitude = (xs: LaningCause[]) =>
    xs
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.weight !== 0)
      .sort((a, b) => Math.abs(b.x.weight) - Math.abs(a.x.weight) || a.i - b.i)
      .map(({ x }) => x);
  const gold = byMagnitude(goldCauses);
  const level = byMagnitude(levelCauses);
  if (cell.id === 'LOST') return [...gold.slice(0, 1), ...level.slice(0, 1)];
  if (cell.gold !== 'EVEN') return gold.slice(0, 2);
  if (cell.level !== 'EVEN') return level.slice(0, 2);
  return [];
}

export function analyzeLaning(ctx: MatchContext): LaningOutcome {
  const me = ctx.me;
  const opponents = [...ctx.players.values()].filter((p) => p.teamId !== me.teamId && p.position === me.position);
  if (opponents.length !== 1) return { result: null, reason: `같은 포지션 상대가 ${opponents.length}명` };
  const opp = opponents[0]!;
  if (!ctx.hasFrames) return { result: null, reason: 'timeline에 participantFrames가 없음' };
  const ref = referencePoint(ctx, me);
  if (!ref) return { result: null, reason: '10분 스냅샷 전에 게임이 끝남' };

  // 기준 시점 이전의 마지막 정각 분 스냅샷
  const fi = Math.floor(ref.refSec / 60);
  const mine = pframe(ctx, fi, me.participantId);
  const theirs = pframe(ctx, fi, opp.participantId);
  if (mine?.totalGold === undefined || theirs?.totalGold === undefined) {
    return { result: null, reason: `${fi}분 스냅샷에 골드 값이 없음` };
  }
  const items: LaningItem[] = [];
  const push = (id: string, a: number, b: number, detail?: LaningItem['detail']) =>
    items.push({ id, me: a, enemy: b, diff: a - b, point: sign(a - b), ...(detail ? { detail } : {}) });

  push('laning.gold', mine.totalGold, theirs.totalGold);
  if (mine.level !== undefined && theirs.level !== undefined) push('laning.level', mine.level, theirs.level);

  const untilMs = ref.refSec * 1000;
  const support = me.position === 'UTILITY';
  const [mk, md, ma] = kda(ctx, me.participantId, untilMs);
  const [ok, od, oa] = kda(ctx, opp.participantId, untilMs);
  const score = (k: number, d: number, a: number) => (support ? k + a - d : k - d);
  push('laning.kda', score(mk, md, ma), score(ok, od, oa), {
    formula: support ? '(K+A)-D' : 'K-D',
    me: [mk, md, ma],
    enemy: [ok, od, oa],
  });

  if (LANING_CS_POSITIONS.includes(me.position)) {
    const a = cs(mine);
    const b = cs(theirs);
    if (a !== undefined && b !== undefined) push('laning.cs', a, b);
  }

  // 원인 설명용 기존 점수 합 (Q4: 판정에는 쓰지 않는다)
  const sum = items.reduce((s, x) => s + x.point, 0);
  const cell = laningCell(mine.totalGold - theirs.totalGold, (mine.level ?? 0) - (theirs.level ?? 0));

  // 2-3 데스 유형
  const mySix = levelSixMs(ctx, me.participantId);
  const oppSix = levelSixMs(ctx, opp.participantId);
  const myDeathEvents = ctx.events.filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === me.participantId && e.timestamp <= untilMs);
  const deaths = myDeathEvents.map((e) => classifyDeath(ctx, me, e, oppSix, mySix));

  // 2-2 로밍
  const roam = analyzeRoam(ctx, me, opp, untilMs);

  // 1장 골드 분해
  const before = (e: TimelineEvent) => e.timestamp <= untilMs;
  const killsBy = (pid: number) => ctx.events.filter((e) => e.type === 'CHAMPION_KILL' && before(e) && e.killerId === pid);
  const bountyOf = (e: TimelineEvent) => (e.bounty ?? 0) + (e.shutdownBounty ?? 0);
  const count = (type: string, pid: number, extra: (e: TimelineEvent) => boolean = () => true) =>
    ctx.events.filter((e) => e.type === type && before(e) && e.killerId === pid && extra(e)).length;
  const base = {
    cs: { me: cs(mine) ?? 0, enemy: cs(theirs) ?? 0 },
    kills: { me: mk, enemy: ok },
    assists: { me: ma, enemy: oa },
    killBounty: pairOf((pid) => killsBy(pid).reduce((s, e) => s + bountyOf(e), 0), me, opp),
    deathBounty: pairOf((pid) => ctx.events.filter((e) => e.type === 'CHAMPION_KILL' && before(e) && e.victimId === pid).reduce((s, e) => s + bountyOf(e), 0), me, opp),
    plates: pairOf((pid) => count('TURRET_PLATE_DESTROYED', pid), me, opp),
    turrets: pairOf((pid) => count('BUILDING_KILL', pid, (e) => e.buildingType === 'TOWER_BUILDING'), me, opp),
    deaths: { me: md, enemy: od },
    enemyKillsOnMe: myDeathEvents.filter((e) => e.killerId === opp.participantId).length,
    enemyAssistsOnMe: myDeathEvents.filter((e) => e.assistingParticipantIds?.includes(opp.participantId)).length,
    outOfLane: { me: roam?.me.length ?? 0, enemy: roam?.enemy.length ?? 0 },
  };
  const growth: LaningGrowth = { ...base, causes: rankCauses(base, cell) };

  return {
    result: {
      referenceSec: Math.round(ref.refSec),
      referenceReason: ref.reason,
      laneTurretSec: ref.turretSec,
      opponent: { participantId: opp.participantId, championId: opp.championId },
      items,
      sum,
      verdict: cell.verdict,
      cell,
      growth,
      deaths,
      roam,
      levelSix: {
        meSec: mySix !== null && mySix <= untilMs ? sec(mySix) : null,
        enemySec: oppSix !== null && oppSix <= untilMs ? sec(oppSix) : null,
      },
      deathsBeforeReferenceSec: myDeathEvents.map((e) => sec(e.timestamp)),
    },
  };
}
