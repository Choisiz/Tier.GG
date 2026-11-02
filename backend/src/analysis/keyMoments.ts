// 2-1 결정적 장면: 골드 격차가 크게 바뀐 싸움 또는 킬이 많이 난 싸움
import { championKills, groupKills, type KillGroup, type ObjectiveKill } from './fights.js';
import { FIGHT_BUILDING_TAIL_MS, KEY_MOMENT } from './rules.js';
import { enemyTeam, lastFrameIndex, participantsOf, sec, teamGoldDiff, type MatchContext } from './timeline.js';
import type { FollowUp, KeyMoment } from './types.js';

export interface MomentCandidate {
  group: KillGroup;
  beforeIndex: number;
  afterIndex: number;
}

/**
 * 모든 킬을 20초 묶음으로 싸움을 만들고, 1분 스냅샷 기준이라 **시작 분이 같은** 싸움은 하나로 합친다
 * (예: 15.1분 1킬 + 15.6분 4킬 → 15.1~15.6분 5킬).
 * 직전 분 = floor(시작), 뒤 분 = ceil(끝 + 60초), 게임 끝 스냅샷을 넘으면 마지막 스냅샷.
 */
export function momentCandidates(ctx: MatchContext): MomentCandidate[] {
  const groups = groupKills(championKills(ctx.events));
  const merged: KillGroup[] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    if (prev && Math.floor(prev.startMs / 60_000) === Math.floor(g.startMs / 60_000)) {
      prev.kills.push(...g.kills);
      prev.endMs = g.endMs;
    } else {
      merged.push({ kills: [...g.kills], startMs: g.startMs, endMs: g.endMs });
    }
  }
  const last = lastFrameIndex(ctx);
  return merged.map((group) => ({
    group,
    beforeIndex: Math.min(Math.floor(group.startMs / 60_000), last),
    afterIndex: Math.min(Math.ceil((group.endMs + KEY_MOMENT.afterMs) / 60_000), last),
  }));
}

function followUps(ctx: MatchContext, g: KillGroup, objectives: readonly ObjectiveKill[]): FollowUp[] {
  const from = g.startMs;
  const to = g.endMs + FIGHT_BUILDING_TAIL_MS;
  const out: FollowUp[] = [];
  for (const e of ctx.events) {
    if (e.type !== 'BUILDING_KILL' || e.timestamp < from || e.timestamp > to || e.teamId === undefined) continue;
    out.push({
      sec: sec(e.timestamp),
      kind: 'BUILDING',
      ours: enemyTeam(e.teamId) === ctx.me.teamId,
      what: [e.buildingType, e.laneType, e.towerType].filter(Boolean).join(':'),
    });
  }
  for (const o of objectives) {
    if (o.timestamp < from || o.timestamp > to) continue;
    out.push({
      sec: sec(o.timestamp),
      kind: 'MONSTER',
      ours: o.killerTeamId === ctx.me.teamId,
      what: [o.kind, o.monsterSubType].filter(Boolean).join(':'),
    });
  }
  return out.sort((a, b) => a.sec - b.sec);
}

/**
 * 고르는 순서 (ai_build.md "설계와 다른 점" 1 참고):
 * ① 격차 변화 3,000 이상인 싸움을 격차 변화 큰 순(같으면 킬 많은 순)
 * ② 남은 자리는 킬 5개 이상만 충족한 싸움을 킬 많은 순(같으면 격차 변화 큰 순)
 * 최대 3개. 설계 9장 예시(격차 1위 · 격차 2위 · 킬 수 1위)와 같은 결과가 나오는 해석이다.
 */
export function analyzeKeyMoments(ctx: MatchContext, objectives: readonly ObjectiveKill[]): KeyMoment[] {
  if (!ctx.hasFrames) return [];
  const me = ctx.me;
  const rows: KeyMoment[] = [];
  for (const c of momentCandidates(ctx)) {
    const before = teamGoldDiff(ctx, c.beforeIndex, me.teamId);
    const after = teamGoldDiff(ctx, c.afterIndex, me.teamId);
    if (before === undefined || after === undefined) continue;
    const swing = after - before;
    const kills = c.group.kills.length;
    const byGold = Math.abs(swing) >= KEY_MOMENT.goldSwingMin;
    if (!byGold && kills < KEY_MOMENT.killsMin) continue;
    let killsOurs = 0;
    for (const k of c.group.kills) {
      const v = k.victimId === undefined ? undefined : ctx.players.get(k.victimId);
      if (v && v.teamId !== me.teamId) killsOurs++;
    }
    const gapChange = Math.abs(after) - Math.abs(before);
    rows.push({
      startSec: sec(c.group.startMs),
      endSec: sec(c.group.endMs),
      kills,
      killsOurs,
      killsTheirs: kills - killsOurs,
      playerInvolved: c.group.kills.some((k) => participantsOf(k).includes(me.participantId)),
      playerDied: c.group.kills.some((k) => k.victimId === me.participantId),
      goldDiffBefore: before,
      goldDiffAfter: after,
      swing,
      gapChange,
      direction: gapChange < 0 ? 'narrowed' : 'widened',
      selectedBy: byGold ? 'GOLD' : 'KILLS',
      followUps: followUps(ctx, c.group, objectives),
    });
  }
  const gold = rows
    .filter((r) => r.selectedBy === 'GOLD')
    .sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing) || b.kills - a.kills);
  const kills = rows
    .filter((r) => r.selectedBy === 'KILLS')
    .sort((a, b) => b.kills - a.kills || Math.abs(b.swing) - Math.abs(a.swing));
  return [...gold, ...kills].slice(0, KEY_MOMENT.max);
}
