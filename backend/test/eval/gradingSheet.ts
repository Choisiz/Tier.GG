// 화면 모양 채점표 (ai_spec Q2 6번): 판마다 화면(FeedbackResult)과 같은 순서·이름으로
// 한 줄 요약 → 라인전/교전/운영(좋은 점·부족한 점) → 결정적 장면. 내부 칸 ID·출처 태그는 쓰지 않는다.
// 칸마다 Q1 기준선 · RAG 이전 · Q2 문장을 나란히 두고 빈 채점 칸을 붙인다. 0원 (파일만 읽음).
// 사용: node --import tsx test/eval/gradingSheet.ts --q1 <결과.json> --rag <결과.json> [--q2 <결과.json>] --out <파일.md>
//   --q2가 없으면 Q2 칸에 템플릿 문장(LLM 실행 전, 0원)을 넣고 그렇게 표시한다.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { championNamesFromJson } from '../../src/analysis/feedback.js';
import { analyzeMatch, championTagsFromJson, ROLE_LABEL } from '../../src/analysis/index.js';
import { buildFacts, type FactSheet } from '../../src/analysis/llm/facts.js';
import { templateFor } from '../../src/analysis/llm/template.js';
import type { AnalysisMatch, AnalysisTimeline } from '../../src/analysis/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

interface Item {
  subjectId: string;
  text: string;
}
interface Feedback {
  summary: { text: string };
  sections: Record<'laning' | 'fight' | 'macro', { good: Item[]; bad: Item[] }>;
  keyMoments: { index: number; text: string }[];
}
interface ResultFile {
  results: { matchId: string; participantId: number; feedback: Feedback }[];
}

/** 화면과 같은 영역 이름·설명 (frontend/src/lib/view/feedback.ts SECTION_META) */
const SECTIONS = [
  { key: 'laning', label: '라인전', hint: null },
  { key: 'fight', label: '교전', hint: '오브젝트 싸움' },
  { key: 'macro', label: '운영', hint: '그 밖의 싸움·시야·파밍' },
] as const;

const gameTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const MARK = '  - 채점: 구체적 조언 [ ] (O 구체적 / △ 막연함 / X 조언 없음) · 근거 없는 주장 [ ] (O 없음 / X 있음)';

function templateFeedback(sheet: FactSheet): Feedback {
  const fb: Feedback = {
    summary: { text: '' },
    sections: { laning: { good: [], bad: [] }, fight: { good: [], bad: [] }, macro: { good: [], bad: [] } },
    keyMoments: [],
  };
  for (const s of sheet.slots) {
    const t = templateFor(sheet, s).text;
    if (s.area === 'summary') fb.summary = { text: t };
    else if (s.area === 'keyMoment') fb.keyMoments.push({ index: s.index!, text: t });
    else fb.sections[s.area][s.kind!].push({ subjectId: s.subjectId!, text: t });
  }
  return fb;
}

function main(): number {
  const { values } = parseArgs({ options: { q1: { type: 'string' }, rag: { type: 'string' }, q2: { type: 'string' }, out: { type: 'string' } } });
  if (!values.q1 || !values.rag || !values.out) {
    console.error('사용: --q1 <결과.json> --rag <결과.json> [--q2 <결과.json>] --out <파일.md>');
    return 1;
  }
  const q1 = readJson<ResultFile>(resolve(values.q1));
  const rag = readJson<ResultFile>(resolve(values.rag));
  const q2 = values.q2 ? readJson<ResultFile>(resolve(values.q2)) : null;
  const q2Label = q2 ? 'Q2' : 'Q2 템플릿(LLM 실행 전)';

  const tagsJson = readJson(join(ROOT, 'test/fixtures/ddragon/champion-tags.json'));
  const tags = championTagsFromJson(tagsJson);
  const names = championNamesFromJson(tagsJson);
  const setDir = join(ROOT, 'test/eval/set5');
  const set = readJson<{ items: { matchId: string; match: string; timeline: string; participantId: number }[] }>(join(setDir, 'set.json'));

  const lines: string[] = [
    '# 화면 모양 채점표: Q1 기준선 · RAG 이전 · Q2 (set5)',
    '',
    `- 문장 출처: **Q1** = \`${values.q1.split('/').pop()}\` (RAG 전 기준선), **RAG** = \`${values.rag.split('/').pop()}\` (Q2 이전 RAG), **${q2Label}** = \`${q2 ? values.q2!.split('/').pop() : '템플릿 (0원)'}\`.`,
    '- 순서·이름은 화면(분석 결과 카드)과 같다: 한 줄 요약 → 라인전 / 교전(오브젝트 싸움) / 운영(그 밖의 싸움·시야·파밍)의 좋은 점·부족한 점 → 결정적 장면.',
    '- 채점은 **Q2 문장**에 한다(앞 두 줄은 비교용). 구체적 조언: O = 이 판의 장면(시각·오브젝트·지역)을 짚고 언제·어디서·무엇을 할지 말함 / △ = 조언은 있으나 막연함 / X = 조언 없음. 근거 없는 주장: O = 없음 / X = 판정·숫자·장면으로 뒷받침되지 않는 원인·평가가 있음.',
    '',
  ];

  set.items.forEach((it, gi) => {
    const match = readJson<AnalysisMatch>(resolve(setDir, it.match));
    const timeline = readJson<AnalysisTimeline>(resolve(setDir, it.timeline));
    const puuid = match.info.participants.find((p) => p.participantId === it.participantId)!.puuid;
    const result = analyzeMatch({ match, timeline, puuid, championTags: tags });
    const sheet = buildFacts(result, names);
    const pick = (f: ResultFile) => f.results.find((r) => r.matchId === it.matchId && r.participantId === it.participantId)!.feedback;
    const versions: [string, Feedback][] = [
      ['Q1', pick(q1)],
      ['RAG', pick(rag)],
      [q2Label, q2 ? pick(q2) : templateFeedback(sheet)],
    ];
    const champ = String(sheet.byId.get('player.champion')!.value);
    const opp = sheet.byId.get('laning.opponent')?.value;
    lines.push(
      `## ${gi + 1}. ${champ} · ${ROLE_LABEL[result.player.role]} 기준`,
      '',
      `- ${it.matchId} · ${result.player.win ? '승리' : '패배'} · ${gameTime(result.player.durationSec)}${opp ? ` · 상대 라이너 ${opp}` : ''}`,
      '',
      '### 한 줄 요약',
      '',
    );
    for (const [v, fb] of versions) lines.push(`- **${v}**: ${fb.summary.text}`);
    lines.push(MARK, '');

    for (const sec of SECTIONS) {
      lines.push(`### ${sec.label}${sec.hint ? ` · ${sec.hint}` : ''}`, '');
      for (const kind of ['good', 'bad'] as const) {
        const subjects = result.speakOrder[sec.key][kind].slice(0, 2);
        if (subjects.length === 0) continue;
        lines.push(`**${kind === 'good' ? '좋은 점' : '부족한 점'}**`, '');
        subjects.forEach((subjectId, i) => {
          lines.push(`${i + 1}.`);
          for (const [v, fb] of versions) {
            const item = fb.sections[sec.key][kind].filter((x) => x.subjectId === subjectId)[0] ?? fb.sections[sec.key][kind][i];
            lines.push(`  - **${v}**: ${item?.text ?? '(없음)'}`);
          }
          lines.push(MARK);
        });
        lines.push('');
      }
      if (result.speakOrder[sec.key].good.length + result.speakOrder[sec.key].bad.length === 0) lines.push('(이 영역은 말할 점 없음)', '');
    }

    if (result.keyMoments.length > 0) {
      lines.push(`### 결정적 장면 · 골드 격차가 크게 움직인 싸움 ${result.keyMoments.length}개`, '');
      result.keyMoments.forEach((km, i) => {
        lines.push(`${i + 1}. ${gameTime(km.startSec)} · 격차 ${km.direction === 'widened' ? '벌어짐' : '좁혀짐'}`);
        for (const [v, fb] of versions) lines.push(`  - **${v}**: ${fb.keyMoments.find((k) => k.index === i)?.text ?? '(없음)'}`);
        lines.push(MARK);
      });
      lines.push('');
    }
  });
  writeFileSync(resolve(values.out), `${lines.join('\n')}\n`);
  console.log(`채점표: ${resolve(values.out)}`);
  return 0;
}

process.exitCode = main();
