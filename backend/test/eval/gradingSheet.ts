// 화면 모양 채점표 (ai_spec Q2 6번): 판마다 화면(FeedbackResult)과 같은 순서·이름으로
// 한 줄 요약 → 라인전/교전/운영(좋은 점·부족한 점) → 결정적 장면. 내부 칸 ID·출처 태그는 쓰지 않는다.
// 칸마다 Q1 기준선 · RAG1 · RAG2 문장을 나란히 두고 빈 채점 칸을 붙인다. 0원 (파일만 읽음).
// 사용: node --import tsx test/eval/gradingSheet.ts --q1 <결과.json> --rag <결과.json> [--q2 <결과.json>] [--rag3] --out <파일.md>
//   --q2가 없으면 Q2 칸에 템플릿 문장(LLM 실행 전, 0원)을 넣고 그렇게 표시한다.
//   --rag3 (Q3): RAG2(--q2) 뒤에 RAG3 템플릿 문장(LLM 전, 0원)을 한 줄 더 두고, 칸마다 발동한 조언 규칙과
//   RAG2 문장을 Q3 검증기로 다시 검사한 결과(조언 규칙 위반만 따로)를 붙인다.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { championNamesFromJson } from '../../src/analysis/feedback.js';
import { analyzeMatch, championTagsFromJson, ROLE_LABEL } from '../../src/analysis/index.js';
import { buildFacts, type FactSheet, type Slot } from '../../src/analysis/llm/facts.js';
import { templateFor } from '../../src/analysis/llm/template.js';
import { verifySlot, type VerifyFailure } from '../../src/analysis/llm/verify.js';
import { allChampionNames } from '../../src/analysis/feedback.js';
import type { AnalysisMatch, AnalysisTimeline } from '../../src/analysis/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

interface Item {
  subjectId: string;
  text: string;
  factIds?: string[];
}
interface Feedback {
  summary: { text: string; factIds?: string[] };
  sections: Record<'laning' | 'fight' | 'macro', { good: Item[]; bad: Item[] }>;
  keyMoments: { index: number; text: string; factIds?: string[] }[];
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

/** Q3 조언 규칙 위반 (근거 없는 조언·근거 미인용·첫 데스 해석) */
const isAdviceFailure = (f: VerifyFailure) => f.rule === 'forbidden' && /^(근거 없는 조언|조언 근거 미인용|첫 데스 해석)/.test(f.detail);

/** 칸에 발동한 규칙 한 줄 (사람이 읽는 말) */
function rulesLine(sheet: FactSheet, slot: Slot | undefined): string {
  if (!slot || slot.rules.length === 0) return '  - 발동 규칙: 없음 → 조언 금지';
  const parts = slot.rules.map((r) => {
    const vals = r.required.map((id) => {
      const f = sheet.byId.get(id)!;
      return `${f.label} ${f.display[0]}${f.unit && f.unit !== '시각' ? f.unit : ''}`;
    });
    return `**${r.id}**${r.action ? '' : '(해석만)'} ${vals.join(', ')}${r.text ? ` → "${r.text}"` : ''}`;
  });
  return `  - 발동 규칙: ${parts.join(' / ')}`;
}

/** RAG2 문장을 Q3 검증기로 다시 검사한 한 줄 */
function reverifyLine(sheet: FactSheet, slot: Slot | undefined, st: { text: string; factIds?: string[] } | undefined, names: readonly string[], tally: Tally): string {
  if (!slot || !st) return '  - RAG2 재검사(Q3 검증기): (문장 없음)';
  const fails = verifySlot(slot, { text: st.text, factIds: st.factIds ?? [] }, { sheet, allChampionNames: names });
  const advice = fails.filter(isAdviceFailure);
  const timeFmt = fails.filter((f) => f.rule === 'number' && /\d\.\d|"\d+"/.test(f.detail) && /분/.test(st.text));
  tally.slots++;
  if (fails.length === 0) {
    tally.pass++;
    return '  - RAG2 재검사(Q3 검증기): 통과';
  }
  if (advice.length > 0) tally.adviceBlocked++;
  const rest = fails.filter((f) => !isAdviceFailure(f));
  const msg = [
    ...advice.map((f) => `**조언 막힘** ${f.detail}`),
    ...(rest.length ? [`그 밖 ${rest.length}건(${[...new Set(rest.map((f) => f.rule))].join('·')}${timeFmt.length ? ', 대부분 "N.N분" → 분:초 표기' : ''})`] : []),
  ];
  return `  - RAG2 재검사(Q3 검증기): 실패 — ${msg.join(' / ')}`;
}

interface Tally {
  slots: number;
  pass: number;
  adviceBlocked: number;
}

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
  const { values } = parseArgs({ options: { q1: { type: 'string' }, rag: { type: 'string' }, q2: { type: 'string' }, rag3: { type: 'boolean', default: false }, out: { type: 'string' } } });
  if (!values.q1 || !values.rag || !values.out) {
    console.error('사용: --q1 <결과.json> --rag <결과.json> [--q2 <결과.json>] --out <파일.md>');
    return 1;
  }
  const q1 = readJson<ResultFile>(resolve(values.q1));
  const rag = readJson<ResultFile>(resolve(values.rag));
  const q2 = values.q2 ? readJson<ResultFile>(resolve(values.q2)) : null;
  const q2Label = q2 ? 'RAG2' : 'RAG2 템플릿(LLM 실행 전)';
  const rag3 = values.rag3 && q2 !== null;
  const tally: Tally = { slots: 0, pass: 0, adviceBlocked: 0 };

  const tagsJson = readJson(join(ROOT, 'test/fixtures/ddragon/champion-tags.json'));
  const tags = championTagsFromJson(tagsJson);
  const names = championNamesFromJson(tagsJson);
  const allNames = allChampionNames(names);
  const setDir = join(ROOT, 'test/eval/set5');
  const set = readJson<{ items: { matchId: string; match: string; timeline: string; participantId: number }[] }>(join(setDir, 'set.json'));

  const lines: string[] = rag3
    ? [
        '# 화면 모양 채점표: Q1 기준선 · RAG1 · RAG2 · RAG3 템플릿 (set5, Q3 미리보기)',
        '',
        `- 문장 출처: **Q1** = \`${values.q1.split('/').pop()}\` (RAG 전 기준선), **RAG1** = \`${values.rag.split('/').pop()}\`, **RAG2** = \`${values.q2!.split('/').pop()}\`, **RAG3** = 템플릿 문장(LLM 실행 전, 0원. 템플릿은 조언을 쓰지 않는다).`,
        '- 순서·이름은 화면(분석 결과 카드)과 같다: 한 줄 요약 → 라인전 / 교전(오브젝트 싸움) / 운영(그 밖의 싸움·시야·파밍)의 좋은 점·부족한 점 → 결정적 장면.',
        '- **발동 규칙**: 그 칸에서 조언 규칙표(R1 반영 비율 · R2/R3 득실 점수+딜 · R4 첫 데스 해석 · R5 단독 데스)가 고른 규칙과 문장에 반드시 쓸 근거 값. "없음"이면 RAG3에서 그 칸은 조언을 쓸 수 없다.',
        '- **RAG2 재검사**: RAG2 녹화 문장을 Q3 검증기로 다시 검사한 결과. "조언 막힘"이 이번 변경으로 새로 막히는 조언이다. 그 밖 실패는 대부분 시각 표기("15.1분" → "15:05")가 바뀐 탓이다.',
        '- 채점은 RAG3 실제 실행(유료, 사용자 별도 승인) 뒤 그 문장에 한다. 지금은 규칙·재검사 결과 확인용이다.',
        '',
      ]
    : [
        '# 화면 모양 채점표: Q1 기준선 · RAG1 · RAG2 (set5)',
        '',
        `- 문장 출처: **Q1** = \`${values.q1.split('/').pop()}\` (RAG 전 기준선), **RAG1** = \`${values.rag.split('/').pop()}\`, **${q2Label}** = \`${q2 ? values.q2!.split('/').pop() : '템플릿 (0원)'}\`.`,
        '- 순서·이름은 화면(분석 결과 카드)과 같다: 한 줄 요약 → 라인전 / 교전(오브젝트 싸움) / 운영(그 밖의 싸움·시야·파밍)의 좋은 점·부족한 점 → 결정적 장면.',
        '- 채점은 **RAG2 문장**에 한다(앞 두 줄은 비교용). 구체적 조언: O = 이 판의 장면(시각·오브젝트·지역)을 짚고 언제·어디서·무엇을 할지 말함 / △ = 조언은 있으나 막연함 / X = 조언 없음. 근거 없는 주장: O = 없음 / X = 판정·숫자·장면으로 뒷받침되지 않는 원인·평가가 있음.',
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
      [rag3 ? 'RAG1' : 'RAG', pick(rag)],
      [q2Label, q2 ? pick(q2) : templateFeedback(sheet)],
      ...(rag3 ? [['RAG3 템플릿', templateFeedback(sheet)] as [string, Feedback]] : []),
    ];
    const rag2 = rag3 ? pick(q2!) : null;
    const extra = (slotId: string, st: { text: string; factIds?: string[] } | undefined) => {
      if (!rag2) return;
      const sl = sheet.slots.find((x) => x.slot === slotId);
      lines.push(rulesLine(sheet, sl), reverifyLine(sheet, sl, st, allNames, tally));
    };
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
    extra('summary', rag2?.summary);
    if (!rag3) lines.push(MARK);
    lines.push('');

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
          extra(`${sec.key}.${kind}.${i}`, rag2?.sections[sec.key][kind].find((x) => x.subjectId === subjectId));
          if (!rag3) lines.push(MARK);
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
        extra(`keyMoment.${i}`, rag2?.keyMoments.find((k) => k.index === i));
        if (!rag3) lines.push(MARK);
      });
      lines.push('');
    }
  });
  if (rag3) {
    lines.push('## RAG2 재검사 합계 (Q3 검증기)', '', `- 칸 ${tally.slots}개 중 통과 ${tally.pass}개, 조언 규칙으로 막힌 칸 ${tally.adviceBlocked}개.`, '');
    console.log(`RAG2 재검사: 칸 ${tally.slots} · 통과 ${tally.pass} · 조언 막힘 ${tally.adviceBlocked}`);
  }
  writeFileSync(resolve(values.out), `${lines.join('\n')}\n`);
  console.log(`채점표: ${resolve(values.out)}`);
  return 0;
}

process.exitCode = main();
