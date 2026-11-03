// 분석 전 사전 검사 (back_spec 변경 05, 05-4 ⑥). 순수 함수.
// 순서: 참가자 → 큐 → 길이 → 포지션. 참가자 검사를 엔진보다 먼저 해 NO_POSITION보다 404가 먼저 나온다.
// 여기서 걸리면 timeline을 부르지 않는다.
import { FEEDBACK_MIN_DURATION_SEC, FEEDBACK_QUEUES } from '../../config/feedback.js';
import type { MatchDto } from '../../riot/types.js';

const POSITIONS = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']);

export type UnsupportedReason = 'queue' | 'too_short' | 'no_position' | 'no_timeline';

export type PrecheckResult =
  | { ok: true }
  | { ok: false; status: 404; code: 'MATCH_NOT_FOUND'; reason: 'participant' }
  | { ok: false; status: 422; code: 'ANALYSIS_UNSUPPORTED'; reason: Exclude<UnsupportedReason, 'no_timeline'> };

export function precheckMatch(match: Pick<MatchDto, 'info'>, puuid: string): PrecheckResult {
  const ps = match.info.participants ?? [];
  if (!ps.some((p) => p.puuid === puuid)) return { ok: false, status: 404, code: 'MATCH_NOT_FOUND', reason: 'participant' };
  if (!FEEDBACK_QUEUES.includes(match.info.queueId)) return { ok: false, status: 422, code: 'ANALYSIS_UNSUPPORTED', reason: 'queue' };
  if (!(match.info.gameDuration >= FEEDBACK_MIN_DURATION_SEC)) {
    return { ok: false, status: 422, code: 'ANALYSIS_UNSUPPORTED', reason: 'too_short' };
  }
  if (ps.length !== 10 || !ps.every((p) => typeof p.teamPosition === 'string' && POSITIONS.has(p.teamPosition))) {
    return { ok: false, status: 422, code: 'ANALYSIS_UNSUPPORTED', reason: 'no_position' };
  }
  return { ok: true };
}
