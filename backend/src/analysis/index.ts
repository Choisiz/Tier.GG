// 판정 엔진 진입점 (ai_spec 1단계). 순수 함수: 네트워크·DB·환경 변수·LLM을 쓰지 않는다.
import { buildAdvice } from './advice.js';
import { analyzeFight } from './fight.js';
import { scoreObjectives } from './fights.js';
import { analyzeKeyMoments } from './keyMoments.js';
import { analyzeLaning } from './laning.js';
import { analyzeMacro } from './macro.js';
import { determineRole, isPosition } from './role.js';
import { ENGINE_VERSION } from './rules.js';
import { buildScenes } from './scenes.js';
import { areaSpeakList, buildSummary, laningSpeakList } from './summary.js';
import { flattenEvents, type MatchContext, type Player } from './timeline.js';
import type { AnalysisInput, AnalysisResult, JudgedResult } from './types.js';

export { ENGINE_VERSION } from './rules.js';
export { championTagsFromJson, ROLE_LABEL, ROLE_OVERRIDES, ROLE_OVERRIDES_PENDING } from './role.js';
export type * from './types.js';

export type AnalysisErrorCode = 'PLAYER_NOT_FOUND' | 'NO_POSITION' | 'MATCH_MISMATCH' | 'NO_FRAMES';

/** 분석할 수 없는 입력 (5단계 API에서 404·422로 바꾼다) */
export class AnalysisError extends Error {
  constructor(
    readonly code: AnalysisErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AnalysisError';
  }
}

function buildContext(input: AnalysisInput): MatchContext {
  const { match, timeline, puuid, championTags } = input;
  const tlId = timeline.metadata?.matchId;
  if (tlId && tlId !== match.metadata.matchId) {
    throw new AnalysisError('MATCH_MISMATCH', `match(${match.metadata.matchId})와 timeline(${tlId})이 다른 판`);
  }
  if (timeline.info.frames.length === 0) throw new AnalysisError('NO_FRAMES', 'timeline에 프레임이 없음');
  const warnings: string[] = [];
  const players = new Map<number, Player>();
  for (const p of match.info.participants) {
    if (!isPosition(p.teamPosition)) {
      throw new AnalysisError('NO_POSITION', `포지션이 없는 참가자가 있음 (participantId ${p.participantId})`);
    }
    if (!championTags.has(p.championId)) warnings.push(`챔피언 태그 없음: ${p.championId} (빈 태그로 유형 판정)`);
    players.set(p.participantId, {
      participantId: p.participantId,
      teamId: p.teamId,
      position: p.teamPosition,
      championId: p.championId,
      role: determineRole(p.teamPosition, p.championId, championTags),
      win: p.win,
      raw: p,
    });
  }
  const meRaw = match.info.participants.find((p) => p.puuid === puuid);
  if (!meRaw) throw new AnalysisError('PLAYER_NOT_FOUND', '그 puuid는 이 판의 참가자가 아님');
  const frames = timeline.info.frames;
  const hasFrames = frames.some((f) => f.participantFrames && Object.keys(f.participantFrames).length > 0);
  if (!hasFrames) warnings.push('timeline에 participantFrames가 없어 스냅샷 지표(라인전·딜·파밍·결정적 장면)를 매기지 않음');
  return {
    matchId: match.metadata.matchId,
    durationSec: match.info.gameDuration,
    frames,
    events: flattenEvents(timeline),
    players,
    me: players.get(meRaw.participantId)!,
    hasFrames,
    warnings,
  };
}

/** match + timeline + puuid → 판정 JSON (문장 없음, 숫자·판정·순서만) */
export function analyzeMatch(input: AnalysisInput): AnalysisResult {
  const { ctx, objectives, result } = analyzeCore(input);
  // 조언 규칙표 (Q3): 판정이 끝난 뒤 문장 재료만 더한다. R1 비교용으로 같은 판을 상대 라이너 기준으로 한 번 더 분석한다 (Riot 호출 없음)
  const oppIds = [...ctx.players.values()].filter((p) => p.teamId !== ctx.me.teamId && p.position === ctx.me.position);
  const oppPlayer = oppIds.length === 1 ? oppIds[0]! : null;
  const opp = oppPlayer ? analyzeCore({ ...input, puuid: oppPlayer.raw.puuid }).result : null;
  return { ...result, advice: buildAdvice(ctx, objectives, result, opp, oppPlayer?.participantId ?? null) };
}

/** 판정 + 장면 (조언 규칙 전) */
function analyzeCore(input: AnalysisInput): { ctx: MatchContext; objectives: ReturnType<typeof scoreObjectives>; result: JudgedResult } {
  const ctx = buildContext(input);
  const objectives = scoreObjectives(ctx.events, ctx.warnings);
  const laning = analyzeLaning(ctx);
  const fight = analyzeFight(ctx, objectives);
  const macro = analyzeMacro(ctx, objectives);
  const keyMoments = analyzeKeyMoments(ctx, objectives);
  const me = ctx.me;
  const speakOrder = {
    laning: laningSpeakList(laning.result),
    fight: areaSpeakList(fight.area),
    macro: areaSpeakList(macro),
  };
  const result: JudgedResult = {
    engineVersion: ENGINE_VERSION,
    matchId: ctx.matchId,
    player: {
      participantId: me.participantId,
      championId: me.championId,
      position: me.position,
      role: me.role,
      win: me.win,
      durationSec: ctx.durationSec,
    },
    laning: laning.result,
    ...(laning.result === null ? { laningUnavailableReason: laning.reason } : {}),
    fight: fight.area,
    macro,
    keyMoments,
    summary: buildSummary(laning.result, fight.area, macro, keyMoments),
    speakOrder,
    notes: fight.notes,
    // 장면(Q2): 판정이 끝난 뒤 문장 재료만 모은다. 점수·등급·말할 순서에 영향 없음
    scenes: buildScenes(ctx, objectives, laning.result, speakOrder),
    warnings: ctx.warnings,
  };
  return { ctx, objectives, result };
}
