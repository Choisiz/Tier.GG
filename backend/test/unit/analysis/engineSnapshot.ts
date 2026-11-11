// 엔진 불변 검사 도우미 (Q2): 장면 facts(scenes)를 더해도 판정(등급·점수·말할 과목·장면·요약)이 그대로인지 보려고
// 판마다 판정 부분의 해시와 읽기 쉬운 요약을 만든다. scenes·engineVersion은 뺀다.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeMatch } from '../../../src/analysis/index.js';
import type { AnalysisMatch, AnalysisResult, AnalysisTimeline } from '../../../src/analysis/types.js';
import { TAGS } from './helpers.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

export interface EngineSnapshot {
  sha256: string;
  grades: Record<string, string | null>;
  totals: { fight: number | null; macro: number | null };
  speakOrder: AnalysisResult['speakOrder'];
  summary: AnalysisResult['summary'];
}

/** 판정 부분만 (scenes·advice·engineVersion 제외. advice는 Q3 조언 규칙, 점수 밖 문장 재료) */
export function judgedPart(r: AnalysisResult): unknown {
  const rest: Record<string, unknown> = { ...r };
  delete rest.engineVersion;
  delete rest.scenes;
  delete rest.advice;
  return rest;
}

export function snapshotOf(r: AnalysisResult): EngineSnapshot {
  const grades: Record<string, string | null> = {};
  for (const s of [...r.fight.subjects, ...r.macro.subjects]) grades[s.id] = s.grade;
  for (const it of r.laning?.items ?? []) grades[it.id] = String(it.point);
  return {
    sha256: createHash('sha256').update(JSON.stringify(judgedPart(r))).digest('hex'),
    grades,
    totals: { fight: r.fight.total, macro: r.macro.total },
    speakOrder: r.speakOrder,
    summary: r.summary,
  };
}

/** 세나 fixture + set5 4판, 판마다 10명 모두 */
export function snapshotGames(): { key: string; match: AnalysisMatch; timeline: AnalysisTimeline }[] {
  const setDir = join(ROOT, 'test/eval/set5');
  const set = readJson<{ items: { matchId: string; match: string; timeline: string }[] }>(join(setDir, 'set.json'));
  return set.items.map((it) => ({
    key: it.matchId,
    match: readJson<AnalysisMatch>(resolve(setDir, it.match)),
    timeline: readJson<AnalysisTimeline>(resolve(setDir, it.timeline)),
  }));
}

export function allSnapshots(): Record<string, EngineSnapshot> {
  const out: Record<string, EngineSnapshot> = {};
  for (const g of snapshotGames()) {
    for (const p of g.match.info.participants) {
      const r = analyzeMatch({ match: g.match, timeline: g.timeline, puuid: p.puuid, championTags: TAGS });
      out[`${g.key}.p${p.participantId}`] = snapshotOf(r);
    }
  }
  return out;
}

export const SNAPSHOT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'data/engine-invariance.2026-11-02.2.json');
