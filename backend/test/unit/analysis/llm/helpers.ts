// 2단계 LLM 테스트 도우미: 세나 판 facts, 이름 표, 통과하는 손 답 만들기
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allChampionNames, championNamesFromJson } from '../../../../src/analysis/feedback.js';
import { analyzeMatch } from '../../../../src/analysis/index.js';
import { buildFacts, type FactSheet } from '../../../../src/analysis/llm/facts.js';
import { templateFor } from '../../../../src/analysis/llm/template.js';
import type { FirstAnswer, VerifyContext } from '../../../../src/analysis/llm/verify.js';
import type { AnalysisResult } from '../../../../src/analysis/types.js';
import { loadSecond, loadSena, puuidOf, TAGS } from '../helpers.js';

const tagsPath = fileURLToPath(new URL('../../../fixtures/ddragon/champion-tags.json', import.meta.url));
export const NAMES = championNamesFromJson(JSON.parse(readFileSync(tagsPath, 'utf8')));
export const ALL_NAMES = allChampionNames(NAMES);

export function senaResult(pid = 5): AnalysisResult {
  const { match, timeline } = loadSena();
  return analyzeMatch({ match, timeline, puuid: puuidOf(pid), championTags: TAGS });
}

export function secondResult(pid: number): AnalysisResult {
  const { match, timeline } = loadSecond();
  return analyzeMatch({ match, timeline, puuid: puuidOf(pid), championTags: TAGS });
}

export function senaSheet(pid = 5): FactSheet {
  return buildFacts(senaResult(pid), NAMES);
}

export const ctxOf = (sheet: FactSheet): VerifyContext => ({ sheet, allChampionNames: ALL_NAMES });

/** 모든 칸을 템플릿 문장으로 채운 "통과하는 첫 답" */
export function passingAnswer(sheet: FactSheet): FirstAnswer {
  const sections: FirstAnswer['sections'] = {
    laning: { good: [], bad: [] },
    fight: { good: [], bad: [] },
    macro: { good: [], bad: [] },
  };
  const keyMoments: FirstAnswer['keyMoments'] = [];
  let summary = { text: '', factIds: [] as string[] };
  for (const s of sheet.slots) {
    const t = templateFor(sheet, s);
    if (s.area === 'summary') summary = t;
    else if (s.area === 'keyMoment') keyMoments.push({ index: s.index!, ...t });
    else sections[s.area][s.kind!].push({ subjectId: s.subjectId!, ...t });
  }
  return { summary, sections, keyMoments };
}
