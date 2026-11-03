// 2단계 진입점 (ai_spec 2-1): 엔진 → facts → LLM 문장 → 검증 → 재시도 → 템플릿 대체.
// 설정값(모델·effort·예산)은 deps로 받는다. 환경 변수를 읽지 않는다 (CLI가 읽어 넘긴다).
// 5단계 !백엔드는 createFeedback 하나만 부른다.
import { analyzeMatch } from './index.js';
import type { LlmClient, LlmEffort } from './llm/client.js';
import type { RecordedCall } from './llm/fakeClient.js';
import { buildFacts, type FactSheet } from './llm/facts.js';
import { generateTexts, type FallbackReason, type GenerateOutcome, type TextSource } from './llm/generate.js';
import { AREAS, type Area } from './llm/labels.js';
import type { Ledger } from './llm/ledger.js';
import type { TokenUsage } from './llm/pricing.js';
import { PROMPT_VERSION } from './llm/prompt.js';
import { LANING_UNAVAILABLE_TEXT } from './llm/template.js';
import type { VerifyFailure } from './llm/verify.js';
import type { AnalysisInput, AnalysisResult } from './types.js';

export interface FeedbackItem {
  subjectId: string;
  text: string;
  factIds: string[];
  source: TextSource;
}

export interface FeedbackResult {
  mode: 'llm' | 'template';
  summary: { text: string; factIds: string[]; source: TextSource };
  sections: Record<Area, { good: FeedbackItem[]; bad: FeedbackItem[]; note?: string }>;
  keyMoments: { index: number; text: string; factIds: string[]; source: TextSource }[];
  meta: {
    engineVersion: string;
    promptVersion: string;
    model: string;
    effort: LlmEffort;
    attempts: number;
    verification: {
      firstPass: number;
      firstTotal: number;
      numberFirstPass: number;
      retried: number;
      templated: number;
      failures: VerifyFailure[];
      retryFailures: VerifyFailure[];
      extras: VerifyFailure[];
    };
    usage: TokenUsage;
    costUsd: number;
    durationMs: number;
    fallbackReason: FallbackReason | null;
  };
}

export interface FeedbackDeps {
  client: LlmClient | null;
  model: string;
  effort: LlmEffort;
  budgetUsd: number;
  ledger: Ledger;
  /** championId → 한국어 이름 (Data Dragon ko_KR) */
  championNames: ReadonlyMap<number, string>;
  now?: () => number;
  inputFactor?: number;
  onCall?: (call: RecordedCall) => void;
  recordingName?: string | null;
}

/** 엔진 결과 + 생성 결과 → 화면용 구조 */
export function assembleFeedback(sheet: FactSheet, out: GenerateOutcome, deps: Pick<FeedbackDeps, 'model' | 'effort'>): FeedbackResult {
  const r = sheet.result;
  const t = (slot: string) => out.texts.get(slot)!;
  const sections = {} as FeedbackResult['sections'];
  for (const area of AREAS) {
    const sec: FeedbackResult['sections'][Area] = { good: [], bad: [] };
    for (const s of sheet.slots.filter((x) => x.area === area)) {
      const ft = t(s.slot);
      sec[s.kind!].push({ subjectId: s.subjectId!, text: ft.text, factIds: ft.factIds, source: ft.source });
    }
    if (area === 'laning' && r.laning === null) sec.note = LANING_UNAVAILABLE_TEXT;
    sections[area] = sec;
  }
  const summary = t('summary');
  return {
    mode: out.mode,
    summary: { text: summary.text, factIds: summary.factIds, source: summary.source },
    sections,
    keyMoments: sheet.slots
      .filter((s) => s.area === 'keyMoment')
      .map((s) => ({ index: s.index!, ...t(s.slot) })),
    meta: {
      engineVersion: r.engineVersion,
      promptVersion: PROMPT_VERSION,
      model: deps.model,
      effort: deps.effort,
      attempts: out.attempts,
      verification: out.verification,
      usage: out.usage,
      costUsd: out.costUsd,
      durationMs: out.durationMs,
      fallbackReason: out.fallbackReason,
    },
  };
}

export function allChampionNames(names: ReadonlyMap<number, string>): string[] {
  return [...new Set(names.values())].sort((a, b) => b.length - a.length);
}

/** 엔진 결과로 문장 피드백을 만든다. 분석 불가(AnalysisError)는 그대로 던진다 */
export function createFeedbackFromResult(deps: FeedbackDeps) {
  return async (result: AnalysisResult): Promise<{ result: AnalysisResult; sheet: FactSheet; feedback: FeedbackResult }> => {
    const sheet = buildFacts(result, deps.championNames);
    const out = await generateTexts(sheet, {
      client: deps.client,
      model: deps.model,
      effort: deps.effort,
      budgetUsd: deps.budgetUsd,
      ledger: deps.ledger,
      allChampionNames: allChampionNames(deps.championNames),
      now: deps.now ?? (() => Date.now()),
      ...(deps.inputFactor !== undefined ? { inputFactor: deps.inputFactor } : {}),
      ...(deps.onCall ? { onCall: deps.onCall } : {}),
      recordingName: deps.recordingName ?? null,
    });
    return { result, sheet, feedback: assembleFeedback(sheet, out, deps) };
  };
}

export function createFeedback(deps: FeedbackDeps) {
  const fromResult = createFeedbackFromResult(deps);
  return async (input: AnalysisInput): Promise<FeedbackResult> => (await fromResult(analyzeMatch(input))).feedback;
}

/** Data Dragon 스냅숏({champions:[{key,name}]}) 또는 champion.json({data:{..:{key,name}}}) → 이름 표 */
export function championNamesFromJson(json: unknown): Map<number, string> {
  const out = new Map<number, string>();
  const add = (key: unknown, name: unknown) => {
    const id = typeof key === 'string' ? Number(key) : key;
    if (typeof id === 'number' && Number.isInteger(id) && typeof name === 'string') out.set(id, name);
  };
  if (json && typeof json === 'object') {
    const o = json as { champions?: unknown; data?: unknown };
    if (Array.isArray(o.champions)) for (const c of o.champions as { key?: unknown; name?: unknown }[]) add(c.key, c.name);
    else if (o.data && typeof o.data === 'object') {
      for (const c of Object.values(o.data as Record<string, { key?: unknown; name?: unknown }>)) add(c.key, c.name);
    }
  }
  return out;
}
