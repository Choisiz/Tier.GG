// 3장 라인전: 기준 시점에 상대 라이너와 비교 (+1 / 0 / −1)
import { LANE_OF_POSITION, LANING, LANING_CS_POSITIONS, SUMMARY } from './rules.js';
import { cs, lastFrameIndex, pframe, sec, type MatchContext, type Player } from './timeline.js';
import type { LaningItem, LaningResult } from './types.js';

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

  const sum = items.reduce((s, x) => s + x.point, 0);
  const verdict = sum >= SUMMARY.laningSumCut ? '우세' : sum <= -SUMMARY.laningSumCut ? '열세' : '비슷';
  const deaths = ctx.events
    .filter((e) => e.type === 'CHAMPION_KILL' && e.victimId === me.participantId && e.timestamp <= untilMs)
    .map((e) => sec(e.timestamp));
  return {
    result: {
      referenceSec: Math.round(ref.refSec),
      referenceReason: ref.reason,
      laneTurretSec: ref.turretSec,
      opponent: { participantId: opp.participantId, championId: opp.championId },
      items,
      sum,
      verdict,
      deathsBeforeReferenceSec: deaths,
    },
  };
}
