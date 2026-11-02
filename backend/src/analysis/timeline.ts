// timeline 읽기 도우미: 참가자 매핑, 분 스냅샷, 팀 골드 차, 이벤트 거르기
import type {
  AnalysisParticipant,
  AnalysisTimeline,
  ParticipantFrame,
  Position,
  Role,
  TimelineEvent,
  TimelineFrame,
} from './types.js';

export interface Player {
  participantId: number;
  teamId: number;
  position: Position;
  championId: number;
  role: Role;
  win: boolean;
  raw: AnalysisParticipant;
}

/** 엔진 전체가 함께 쓰는 판 정보 */
export interface MatchContext {
  matchId: string;
  durationSec: number;
  frames: readonly TimelineFrame[];
  /** 시각 순으로 펼친 모든 이벤트 */
  events: readonly TimelineEvent[];
  players: ReadonlyMap<number, Player>;
  me: Player;
  /** participantFrames가 하나라도 있나 (없는 timeline도 오류 없이 돌게) */
  hasFrames: boolean;
  warnings: string[];
}

export function flattenEvents(timeline: AnalysisTimeline): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const f of timeline.info.frames) out.push(...(f.events ?? []));
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

export function frameAt(ctx: MatchContext, index: number): TimelineFrame | undefined {
  if (ctx.frames.length === 0) return undefined;
  return ctx.frames[Math.max(0, Math.min(index, ctx.frames.length - 1))];
}

export function lastFrameIndex(ctx: MatchContext): number {
  return ctx.frames.length - 1;
}

/** 프레임 시각(ms). timestamp가 없으면 index × 60초 */
export function frameMs(ctx: MatchContext, index: number): number {
  const f = frameAt(ctx, index);
  const i = Math.max(0, Math.min(index, ctx.frames.length - 1));
  return f?.timestamp ?? i * 60_000;
}

export function pframe(ctx: MatchContext, index: number, participantId: number): ParticipantFrame | undefined {
  return frameAt(ctx, index)?.participantFrames?.[String(participantId)];
}

export function cs(pf: ParticipantFrame | undefined): number | undefined {
  if (!pf || pf.minionsKilled === undefined) return undefined;
  return pf.minionsKilled + (pf.jungleMinionsKilled ?? 0);
}

export function damageToChampions(ctx: MatchContext, index: number, participantId: number): number | undefined {
  return pframe(ctx, index, participantId)?.damageStats?.totalDamageDoneToChampions;
}

/** 그 프레임의 팀 골드 차 (teamId 기준, 양수 = teamId가 앞섬). 값이 빠진 참가자가 있으면 undefined */
export function teamGoldDiff(ctx: MatchContext, index: number, teamId: number): number | undefined {
  let diff = 0;
  for (const p of ctx.players.values()) {
    const g = pframe(ctx, index, p.participantId)?.totalGold;
    if (g === undefined) return undefined;
    diff += p.teamId === teamId ? g : -g;
  }
  return diff;
}

export function enemyTeam(teamId: number): number {
  return teamId === 100 ? 200 : 100;
}

export function isChampionKill(e: TimelineEvent): boolean {
  return e.type === 'CHAMPION_KILL';
}

export function participantsOf(e: TimelineEvent): number[] {
  const ids: number[] = [];
  if (e.killerId !== undefined) ids.push(e.killerId);
  if (e.victimId !== undefined) ids.push(e.victimId);
  ids.push(...(e.assistingParticipantIds ?? []));
  return ids;
}

export const sec = (ms: number): number => Math.round(ms / 100) / 10;
export const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};
