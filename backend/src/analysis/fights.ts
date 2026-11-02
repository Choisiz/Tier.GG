// 싸움 묶기(20초), 오브젝트 점수, 오브젝트 창(처치 앞뒤 40초, 겹치면 합침), 득실 점수
import {
  FIGHT_GAP_MS,
  INHIBITOR_POINTS,
  KILL_POINTS,
  OBJECTIVE_POINTS,
  OBJECTIVE_WINDOW_MS,
  SOUL_DRAGON_NTH,
  TURRET_POINTS,
} from './rules.js';
import { enemyTeam, isChampionKill, participantsOf, type MatchContext } from './timeline.js';
import type { TimelineEvent } from './types.js';

export type ObjectiveKind = 'BARON' | 'DRAGON' | 'SOUL_DRAGON' | 'ELDER_DRAGON' | 'RIFTHERALD' | 'HORDE';

export interface ObjectiveKill {
  timestamp: number;
  kind: ObjectiveKind;
  monsterType: string;
  monsterSubType?: string;
  killerId: number;
  killerTeamId: number;
  points: number;
}

/**
 * 5-3: ELITE_MONSTER_KILL마다 점수. 영혼 용은 "그 팀의 4번째(장로 제외) 용"으로 센다.
 * DRAGON_SOUL_GIVEN 이벤트는 쓰지 않는다: 16.21 판에서 두 번째 용 직후 teamId 0으로 나오는
 * "영혼 속성 공개" 이벤트가 있어, 이벤트 시각으로 판정하면 일반 용을 영혼 용으로 잘못 센다.
 * 점수표에 없는 몬스터(예: ATAKHAN)는 오브젝트로 보지 않고 경고에 남긴다.
 */
export function scoreObjectives(events: readonly TimelineEvent[], warnings?: string[]): ObjectiveKill[] {
  const dragonsByTeam = new Map<number, number>();
  const out: ObjectiveKill[] = [];
  const unknown = new Set<string>();
  for (const e of events) {
    if (e.type !== 'ELITE_MONSTER_KILL') continue;
    const type = e.monsterType ?? '';
    const team = e.killerTeamId ?? 0;
    let kind: ObjectiveKind;
    let points: number;
    if (type === 'DRAGON') {
      if (e.monsterSubType === 'ELDER_DRAGON') {
        kind = 'ELDER_DRAGON';
        points = OBJECTIVE_POINTS.ELDER_DRAGON;
      } else {
        const n = (dragonsByTeam.get(team) ?? 0) + 1;
        dragonsByTeam.set(team, n);
        kind = n === SOUL_DRAGON_NTH ? 'SOUL_DRAGON' : 'DRAGON';
        points = n === SOUL_DRAGON_NTH ? OBJECTIVE_POINTS.SOUL_DRAGON : OBJECTIVE_POINTS.DRAGON;
      }
    } else if (type === 'BARON_NASHOR') {
      kind = 'BARON';
      points = OBJECTIVE_POINTS.BARON_NASHOR;
    } else if (type === 'RIFTHERALD') {
      kind = 'RIFTHERALD';
      points = OBJECTIVE_POINTS.RIFTHERALD;
    } else if (type === 'HORDE') {
      kind = 'HORDE';
      points = OBJECTIVE_POINTS.HORDE;
    } else {
      unknown.add(type || '(없음)');
      continue;
    }
    out.push({
      timestamp: e.timestamp,
      kind,
      monsterType: type,
      monsterSubType: e.monsterSubType,
      killerId: e.killerId ?? 0,
      killerTeamId: team,
      points,
    });
  }
  if (warnings && unknown.size > 0) warnings.push(`점수표에 없는 몬스터는 제외: ${[...unknown].join(', ')}`);
  return out;
}

export interface Window {
  start: number;
  end: number;
}

/** 오브젝트 처치 시각 앞뒤 halfMs 창. 겹치거나 맞닿으면 합친다 */
export function mergeWindows(times: readonly number[], halfMs: number = OBJECTIVE_WINDOW_MS): Window[] {
  const ws = [...times].sort((a, b) => a - b).map((t) => ({ start: t - halfMs, end: t + halfMs }));
  const out: Window[] = [];
  for (const w of ws) {
    const last = out[out.length - 1];
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else out.push({ ...w });
  }
  return out;
}

export const inWindow = (ts: number, w: Window): boolean => w.start <= ts && ts <= w.end;
export const inAnyWindow = (ts: number, ws: readonly Window[]): boolean => ws.some((w) => inWindow(ts, w));

export interface KillGroup {
  kills: TimelineEvent[];
  startMs: number;
  endMs: number;
}

/** 킬 사이 간격이 gapMs 이하면 같은 싸움 */
export function groupKills(kills: readonly TimelineEvent[], gapMs: number = FIGHT_GAP_MS): KillGroup[] {
  const out: KillGroup[] = [];
  for (const k of kills) {
    const last = out[out.length - 1];
    if (last && k.timestamp - last.endMs <= gapMs) {
      last.kills.push(k);
      last.endMs = k.timestamp;
    } else {
      out.push({ kills: [k], startMs: k.timestamp, endMs: k.timestamp });
    }
  }
  return out;
}

export function championKills(events: readonly TimelineEvent[]): TimelineEvent[] {
  return events.filter(isChampionKill);
}

/** 팀별 득점 */
export type TeamPoints = Map<number, number>;

export function addPoints(g: TeamPoints, team: number, pts: number): void {
  g.set(team, (g.get(team) ?? 0) + pts);
}

/** 5-4: 킬은 죽은 플레이어의 포지션 점수를 상대 팀이 얻는다 */
export function addKillPoints(ctx: MatchContext, g: TeamPoints, kill: TimelineEvent): void {
  const victim = kill.victimId === undefined ? undefined : ctx.players.get(kill.victimId);
  if (!victim) return;
  addPoints(g, enemyTeam(victim.teamId), KILL_POINTS[victim.position]);
}

/** 5-4: 포탑 10, 억제기 20. BUILDING_KILL의 teamId는 건물을 잃은 팀이다 */
export function buildingPoints(e: TimelineEvent): number {
  return e.buildingType === 'INHIBITOR_BUILDING' ? INHIBITOR_POINTS : TURRET_POINTS;
}

export function addBuildingPoints(g: TeamPoints, e: TimelineEvent): void {
  if (e.teamId === undefined) return;
  addPoints(g, enemyTeam(e.teamId), buildingPoints(e));
}

/** 킬의 킬러·피해자·어시 모두 */
export function involvedIn(kills: readonly TimelineEvent[]): Set<number> {
  const s = new Set<number>();
  for (const k of kills) for (const id of participantsOf(k)) s.add(id);
  return s;
}

/** 오브젝트 싸움: 창마다 그 안의 킬·포탑·억제기·오브젝트 득점과 관여자 */
export interface ObjectiveFight {
  window: Window;
  kills: TimelineEvent[];
  points: TeamPoints;
  involved: Set<number>;
}

export function objectiveFights(ctx: MatchContext, objectives: readonly ObjectiveKill[]): ObjectiveFight[] {
  const windows = mergeWindows(objectives.map((o) => o.timestamp));
  return windows.map((w) => {
    const kills = ctx.events.filter((e) => isChampionKill(e) && inWindow(e.timestamp, w));
    const points: TeamPoints = new Map();
    for (const k of kills) addKillPoints(ctx, points, k);
    for (const e of ctx.events) if (e.type === 'BUILDING_KILL' && inWindow(e.timestamp, w)) addBuildingPoints(points, e);
    for (const o of objectives) if (inWindow(o.timestamp, w)) addPoints(points, o.killerTeamId, o.points);
    return { window: w, kills, points, involved: involvedIn(kills) };
  });
}
