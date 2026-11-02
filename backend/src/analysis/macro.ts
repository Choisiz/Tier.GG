// 6장 운영: 오브젝트 싸움(처치 앞뒤 40초) 밖의 과정. 과목 5개, 반영 비율 6-2
import { visionObjectiveTimes, inVisionWindow, wardPoints } from './fight.js';
import {
  addBuildingPoints,
  addKillPoints,
  championKills,
  groupKills,
  inAnyWindow,
  involvedIn,
  mergeWindows,
  type ObjectiveKill,
  type TeamPoints,
} from './fights.js';
import {
  FARM_CUTS,
  FARM_MIN_GAME_SEC,
  FARM_START_MIN,
  FIGHT_BUILDING_TAIL_MS,
  MACRO_ADVANTAGE_CUTS,
  MACRO_WEIGHTS,
  NORMAL_VISION_CUTS,
  SIDE_CUTS,
  SOLO_CUTS,
  gradeByCuts,
} from './rules.js';
import { area, graded, ungraded } from './score.js';
import { cs, enemyTeam, frameMs, lastFrameIndex, pframe, round, type MatchContext } from './timeline.js';
import type { AreaResult, SubjectResult } from './types.js';

export interface OutsideFight {
  startMs: number;
  endMs: number;
  killCount: number;
  points: TeamPoints;
  involved: Set<number>;
  /** 킬 1개로 끝난 싸움의 킬러·피해자 */
  soloKiller?: number;
  soloVictim?: number;
}

/**
 * 오브젝트 창 밖의 킬을 20초 묶음으로 싸움으로 만든다.
 * 득실: 킬(포지션 점수) + 싸움 시작 ~ 마지막 킬 60초 뒤의 포탑·억제기(창 밖인 것만). 오브젝트는 넣지 않는다.
 */
export function outsideFights(ctx: MatchContext, objectives: readonly ObjectiveKill[]): OutsideFight[] {
  const windows = mergeWindows(objectives.map((o) => o.timestamp));
  const kills = championKills(ctx.events).filter((k) => !inAnyWindow(k.timestamp, windows));
  return groupKills(kills).map((g) => {
    const points: TeamPoints = new Map();
    for (const k of g.kills) addKillPoints(ctx, points, k);
    for (const e of ctx.events) {
      if (e.type !== 'BUILDING_KILL') continue;
      if (e.timestamp < g.startMs || e.timestamp > g.endMs + FIGHT_BUILDING_TAIL_MS) continue;
      if (inAnyWindow(e.timestamp, windows)) continue;
      addBuildingPoints(points, e);
    }
    const f: OutsideFight = { startMs: g.startMs, endMs: g.endMs, killCount: g.kills.length, points, involved: involvedIn(g.kills) };
    if (g.kills.length === 1) {
      f.soloKiller = g.kills[0]!.killerId;
      f.soloVictim = g.kills[0]!.victimId;
    }
    return f;
  });
}

function advantageSubject(ctx: MatchContext, weight: number, fights: readonly OutsideFight[]): SubjectResult {
  const mine = fights.filter((f) => f.involved.has(ctx.me.participantId));
  let ours = 0;
  let theirs = 0;
  for (const f of mine) {
    ours += f.points.get(ctx.me.teamId) ?? 0;
    theirs += f.points.get(enemyTeam(ctx.me.teamId)) ?? 0;
  }
  if (ours + theirs === 0) return ungraded('macro.advantage', weight, '오브젝트 창 밖 싸움에 끼지 않음', { fights: mine.length });
  const pct = (100 * ours) / (ours + theirs);
  return graded('macro.advantage', weight, gradeByCuts(pct, MACRO_ADVANTAGE_CUTS), {
    fights: mine.length,
    ours,
    theirs,
    sharePct: round(pct, 1),
  });
}

function soloSubject(ctx: MatchContext, weight: number, fights: readonly OutsideFight[]): SubjectResult {
  let kills = 0;
  let deaths = 0;
  for (const f of fights) {
    if (f.killCount !== 1) continue;
    if (f.soloKiller === ctx.me.participantId) kills++;
    if (f.soloVictim === ctx.me.participantId) deaths++;
  }
  return graded('macro.solo', weight, gradeByCuts(kills - deaths, SOLO_CUTS), { kills, deaths, net: kills - deaths });
}

function sideSubject(ctx: MatchContext, weight: number): SubjectResult {
  if (weight <= 0) return ungraded('macro.side', 0, '이 유형은 매기지 않음 (반영 비율 0)');
  const dmg = ctx.me.raw.damageDealtToTurrets;
  if (dmg === undefined || ctx.durationSec <= 0) return ungraded('macro.side', weight, 'damageDealtToTurrets 없음');
  const perMin = dmg / (ctx.durationSec / 60);
  return graded('macro.side', weight, gradeByCuts(perMin, SIDE_CUTS[ctx.me.position]), {
    turretDamage: dmg,
    perMinute: round(perMin, 1),
  });
}

function farmSubject(ctx: MatchContext, weight: number): SubjectResult {
  const cuts = FARM_CUTS[ctx.me.position];
  if (weight <= 0 || !cuts) return ungraded('macro.farm', 0, '이 유형은 매기지 않음 (반영 비율 0)');
  if (ctx.durationSec < FARM_MIN_GAME_SEC) return ungraded('macro.farm', weight, '20분 미만 게임');
  const last = lastFrameIndex(ctx);
  const a = cs(pframe(ctx, FARM_START_MIN, ctx.me.participantId));
  const b = cs(pframe(ctx, last, ctx.me.participantId));
  if (a === undefined || b === undefined || last <= FARM_START_MIN) return ungraded('macro.farm', weight, 'CS 스냅샷 없음');
  // 분모는 실제 경과 시간(15분 스냅샷 → 게임 끝 스냅샷)
  const minutes = (frameMs(ctx, last) - frameMs(ctx, FARM_START_MIN)) / 60_000;
  const perMin = (b - a) / minutes;
  return graded('macro.farm', weight, gradeByCuts(perMin, cuts), {
    cs15: a,
    csEnd: b,
    minutes: round(minutes, 2),
    perMinute: round(perMin, 2),
  });
}

function visionSubject(ctx: MatchContext, weight: number, objectives: readonly ObjectiveKill[]): SubjectResult {
  const times = visionObjectiveTimes(objectives);
  let points = 0;
  for (const e of ctx.events) {
    if (inVisionWindow(e.timestamp, times)) continue;
    points += wardPoints(e, ctx.me.participantId);
  }
  const minutes = ctx.durationSec / 60;
  if (minutes <= 0) return ungraded('macro.vision', weight, '게임 시간 0');
  const per = points / minutes;
  return graded('macro.vision', weight, gradeByCuts(per, NORMAL_VISION_CUTS[ctx.me.position]), {
    points,
    minutes: round(minutes, 2),
    perMinute: round(per, 2),
  });
}

export function analyzeMacro(ctx: MatchContext, objectives: readonly ObjectiveKill[]): AreaResult {
  const w = MACRO_WEIGHTS[ctx.me.role];
  const fights = outsideFights(ctx, objectives);
  return area({ ...w }, [
    advantageSubject(ctx, w.advantage, fights),
    soloSubject(ctx, w.solo, fights),
    sideSubject(ctx, w.side),
    farmSubject(ctx, w.farm),
    visionSubject(ctx, w.vision, objectives),
  ]);
}
