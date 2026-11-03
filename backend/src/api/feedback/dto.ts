// 게임 피드백 분석 응답 (api_contract v4 2-7, back_spec 변경 05, 05-2).
// !ai의 FeedbackResult에서 화면에 필요한 것만 고른다. 등급·점수·가중치·근거 ID·출처·모델·토큰·비용·puuid는 넣지 않는다.
import type { FeedbackResult } from '../../analysis/feedback.js';
import type { AnalysisResult, Position, Role } from '../../analysis/types.js';

export type TemplateReason = 'llm_off' | 'llm_error';

export interface FeedbackItemDto {
  subjectId: string;
  text: string;
}

export interface FeedbackSectionDto {
  good: FeedbackItemDto[];
  bad: FeedbackItemDto[];
  note: string | null;
}

export interface FeedbackKeyMomentDto {
  startSec: number;
  endSec: number;
  direction: 'widened' | 'narrowed';
  text: string;
}

export interface FeedbackDto {
  matchId: string;
  championId: number;
  position: Position;
  role: Role;
  win: boolean;
  mode: 'llm' | 'template';
  templateReason: TemplateReason | null;
  summary: { text: string };
  sections: { laning: FeedbackSectionDto; fight: FeedbackSectionDto; macro: FeedbackSectionDto };
  keyMoments: FeedbackKeyMomentDto[];
  meta: {
    engineVersion: string;
    promptVersion: string;
    knowledgeVersion: string | null;
    championDataVersion: string;
    generatedAt: string;
  };
}

export interface FeedbackDtoMeta {
  /** mode="template"일 때 이유. mode="llm"이면 무시하고 null */
  templateReason: TemplateReason | null;
  knowledgeVersion: string | null;
  championDataVersion: string;
  generatedAtMs: number;
}

/** 응답에 절대 나오면 안 되는 키 (단위 테스트가 재귀로 확인) */
export const FORBIDDEN_DTO_KEYS = [
  'grade',
  'gradePoint',
  'score',
  'total',
  'weight',
  'impact',
  'verdict',
  'factIds',
  'source',
  'usage',
  'costUsd',
  'model',
  'effort',
  'verification',
  'fallbackReason',
  'durationMs',
  'attempts',
  'puuid',
] as const;

const section = (s: FeedbackResult['sections']['laning']): FeedbackSectionDto => ({
  good: s.good.map((x) => ({ subjectId: x.subjectId, text: x.text })),
  bad: s.bad.map((x) => ({ subjectId: x.subjectId, text: x.text })),
  note: s.note ?? null,
});

/** 엔진 결과 + 문장 결과 → 응답. 순수 함수 */
export function toFeedbackDto(result: AnalysisResult, feedback: FeedbackResult, meta: FeedbackDtoMeta): FeedbackDto {
  const keyMoments: FeedbackKeyMomentDto[] = [];
  for (const k of feedback.keyMoments) {
    const m = result.keyMoments[k.index];
    if (!m) continue; // 엔진 결과에 없는 index는 버린다 (생기면 안 됨)
    keyMoments.push({ startSec: m.startSec, endSec: m.endSec, direction: m.direction, text: k.text });
  }
  return {
    matchId: result.matchId,
    championId: result.player.championId,
    position: result.player.position,
    role: result.player.role,
    win: result.player.win,
    mode: feedback.mode,
    templateReason: feedback.mode === 'llm' ? null : meta.templateReason ?? 'llm_error',
    summary: { text: feedback.summary.text },
    sections: {
      laning: section(feedback.sections.laning),
      fight: section(feedback.sections.fight),
      macro: section(feedback.sections.macro),
    },
    keyMoments,
    meta: {
      engineVersion: feedback.meta.engineVersion,
      promptVersion: feedback.meta.promptVersion,
      knowledgeVersion: meta.knowledgeVersion,
      championDataVersion: meta.championDataVersion,
      generatedAt: new Date(meta.generatedAtMs).toISOString(),
    },
  };
}
