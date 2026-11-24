// 단일 실행 화면 모양 채점표 (Q4 검증, Q5: 칸마다 "판단 틀" 줄, 결정적 장면 시간순): 결과 JSON 1개 + 세트 폴더 → 판마다 md 1개. 0원 (파일만 읽음).
// 사용: node --import tsx test/eval/sheetOne.ts --result <결과.json> --set <세트 폴더> --label <이름> --outdir <폴더> [--prefix 2026-11-22.q5]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rulesFor } from '../../src/analysis/advice.js';
import { frameworkLabelsOf } from '../../src/analysis/coverage.js';
import { championNamesFromJson, type FeedbackResult } from '../../src/analysis/feedback.js';
import { analyzeMatch, championTagsFromJson, ROLE_LABEL } from '../../src/analysis/index.js';
import { buildFacts, type Slot } from '../../src/analysis/llm/facts.js';
import { REGION_LABEL, SUBJECT_LABEL } from '../../src/analysis/llm/labels.js';
import type { AnalysisMatch, AnalysisTimeline, FactValue } from '../../src/analysis/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
const RULE_NAME: Record<string, string> = {
  R1: '반영 비율', R2: '득실+딜 낮음', R3: '득실+딜 높음', R4: '내 역할 해석', R5: '단독 데스',
  R6: '1:1 데스', R7: '갱 데스', R8: '라인전 성장 원인', R9: '로밍 대응', R10: '오브젝트 싸움 버티기', R11: '오브젝트 전 제어 와드',
  R12: '오브젝트 싸움 내 기여 낮음',
};
const subjectName = (id: string) => SUBJECT_LABEL[id] ?? id;

interface ResultFile {
  promptVersion: string;
  results: { matchId: string; participantId: number; feedback: FeedbackResult }[];
}
interface SetFile {
  items: { matchId: string; match: string; timeline: string; participantId: number; note: string }[];
}

function fmtFacts(facts: Record<string, FactValue>, champ: (id: number) => string): string {
  return Object.entries(facts)
    .map(([k, v]) => {
      if (/sec$|Sec$/i.test(k) && typeof v === 'number') return `${k} ${mmss(v)}`;
      if (Array.isArray(v) && /sec/i.test(k)) return `${k} ${v.map((x) => mmss(Number(x))).join('·')}`;
      if (k.toLowerCase().includes('region') && typeof v === 'string') return `${k} ${REGION_LABEL[v] ?? v}`;
      if (/Id$/.test(k) && typeof v === 'number' && k !== 'count') return `${k} ${champ(v)}`;
      return `${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`;
    })
    .join(', ');
}

const { values } = parseArgs({ options: { result: { type: 'string' }, set: { type: 'string' }, label: { type: 'string' }, outdir: { type: 'string' }, prefix: { type: 'string', default: '2026-11-22.q5' } } });
const res = readJson<ResultFile>(resolve(values.result!));
const setDir = resolve(values.set!);
const set = readJson<SetFile>(join(setDir, 'set.json'));
const tagsJson = readJson<unknown>(join(ROOT, 'test/fixtures/ddragon/champion-tags.json'));
const tags = championTagsFromJson(tagsJson);
const names = championNamesFromJson(tagsJson);
for (const it of set.items) {
  const match = readJson<AnalysisMatch>(join(setDir, it.match));
  const timeline = readJson<AnalysisTimeline>(join(setDir, it.timeline));
  const raw = match.info.participants;
  const puuid = raw.find((p) => p.participantId === it.participantId)!.puuid;
  const a = analyzeMatch({ match, timeline, puuid, championTags: tags });
  const sheet = buildFacts(a, names);
  const champOf = (pid: number) => names.get(raw.find((p) => p.participantId === pid)?.championId ?? -1) ?? `p${pid}`;
  const r = res.results.find((x) => x.matchId === it.matchId && x.participantId === it.participantId);
  if (!r) continue;
  const fb = r.feedback;
  // 결과 문장 → 지금 엔진의 칸 (같은 영역·방향·과목, 앞에서부터). 옛 결과라 칸이 없으면 과목만으로 판단 틀을 정한다
  const used = new Set<string>();
  const slotFor = (area: string, kind: 'good' | 'bad', subjectId: string): Slot | null => {
    const s = sheet.slots.find((x) => x.area === area && x.kind === kind && x.subjectId === subjectId && !used.has(x.slot)) ?? null;
    if (s) used.add(s.slot);
    return s;
  };
  const ruleLine = (slot: Slot | null, subjectId: string, kind: 'good' | 'bad') => {
    const hit = slot ? slot.rules.map((x) => ({ id: x.id, merged: !!x.merged, subjectId: x.subjectId })) : rulesFor(a.advice, subjectId, kind).map((x) => ({ id: x.id, merged: false, subjectId: x.subjectId }));
    if (hit.length === 0) return '없음 → 조언 금지';
    return hit
      .map((h) => {
        const fr = a.advice.rules.find((x) => x.id === h.id && x.kind === kind && (x.subjectId === h.subjectId || h.id === 'R10'));
        return `**${h.id}** ${RULE_NAME[h.id] ?? ''}${h.merged ? ' (합침)' : ''}${fr ? ` (${fmtFacts(fr.facts, champOf)})` : ''}`;
      })
      .join(' / ');
  };
  const frameLine = (slot: Slot | null, subjectId: string, kind: 'good' | 'bad') =>
    frameworkLabelsOf(slot ? { subjectId, origin: slot.origin, rules: slot.rules } : { subjectId, origin: 'graded', rules: rulesFor(a.advice, subjectId, kind) }, subjectName).join(' / ');
  const me = champOf(it.participantId);
  const opp = a.laning ? champOf(a.laning.opponent.participantId) : '-';
  const L: string[] = [
    `# 채점표 (${me} · ${ROLE_LABEL[a.player.role]})`,
    '',
    `- 판: ${it.matchId} · ${a.player.win ? '승리' : '패배'} · ${mmss(a.player.durationSec)} · 상대 라이너 ${opp}. 순서는 화면과 같음.`,
    `- 문장: ${values.label} (\`${values.result!.split('/').pop()}\`, 프롬프트 ${res.promptVersion}, 엔진 ${a.engineVersion}). 라인전 판정 = ${a.laning ? `${a.laning.cell.label} (요약 ${a.laning.verdict})` : '-'}.`,
    '- **판단 틀**: 그 칸이 다루는 사용자 판단 틀 항목(라인전 · 내 성장/데스/팀 성장, 오브젝트 · 딜량/이니시/버티기/시야, 교전 · 골드 격차/로밍 KDA, 기존 과목). "(합침)"은 칸이 다 차서 이 칸에 합친 항목.',
    '- **근거 규칙**: 그 칸에서 조언을 고른 규칙과 근거 값(코드가 계산). R1 반영 비율 · R2/R3 득실+딜 · R4 내 역할 해석 · R5 단독 데스 · R6 1:1 데스 · R7 갱 데스 · R8 라인전 성장 원인 · R9 로밍 대응 · R10 오브젝트 싸움 버티기 · R11 오브젝트 전 제어 와드 · R12 오브젝트 싸움 내 기여 낮음(해석) · 칭찬 P1~P4. "없음"이면 조언을 쓰지 않음.',
    '- 채점: 구체적 조언 O(구체적) / △(막연함) / X(조언 없음·필요 없음) · 근거 없는 주장 O(없음) / X(있음). 메모 칸에 자유롭게.',
    '',
    '### 한 줄 요약',
    '',
    `  - ${fb.summary.text}`,
    '  - 판단 틀: 요약 (영역 판정 + 결정적 장면)',
    '  - 근거 규칙: 없음 → 조언 금지',
    '  - 채점: 구체적 조언 [ ] · 근거 없는 주장 [ ] · 메모: ',
    '',
  ];
  const AREA: [keyof FeedbackResult['sections'], string][] = [['laning', '라인전'], ['fight', '교전 · 오브젝트 싸움'], ['macro', '운영 · 그 밖의 싸움·시야·파밍']];
  for (const [area, title] of AREA) {
    const sec = fb.sections[area];
    if (sec.good.length === 0 && sec.bad.length === 0) continue;
    L.push(`### ${title}`, '');
    for (const [kind, kt] of [['good', '좋은 점'], ['bad', '부족한 점']] as const) {
      if (sec[kind].length === 0) continue;
      L.push(`**${kt}**`, '');
      sec[kind].forEach((x, i) => {
        const slot = slotFor(area, kind, x.subjectId);
        L.push(`${i + 1}.`, `  - ${x.text}`, `  - 판단 틀: ${frameLine(slot, x.subjectId, kind)}`, `  - 근거 규칙: ${ruleLine(slot, x.subjectId, kind)}`, '  - 채점: 구체적 조언 [ ] · 근거 없는 주장 [ ] · 메모: ');
      });
      L.push('');
    }
  }
  // Q5(A5): 결정적 장면은 시간순
  const kms = fb.keyMoments
    .map((k, i) => ({ k, m: a.keyMoments[k.index ?? i] }))
    .sort((x, y) => (x.m?.startSec ?? 0) - (y.m?.startSec ?? 0));
  if (kms.length) {
    L.push(`### 결정적 장면 · 골드 격차가 크게 움직인 싸움 ${kms.length}개 (시간순)`, '');
    kms.forEach(({ k, m }, i) => {
      L.push(`${i + 1}. ${m ? `${mmss(m.startSec)} · 우리 팀 ${m.swing < 0 ? '손해' : '이득'} 약 ${Math.abs(m.swing).toLocaleString('en-US')}` : ''}`, `  - ${k.text}`, '  - 판단 틀: 교전 · 골드 격차', '  - 근거 규칙: 없음 → 조언 금지', '  - 채점: 구체적 조언 [ ] · 근거 없는 주장 [ ] · 메모: ');
    });
    L.push('');
  }
  const champEn = (raw.find((p) => p.participantId === it.participantId)?.championName ?? `p${it.participantId}`).toLowerCase();
  const out = join(resolve(values.outdir!), `${values.prefix}.${champEn}.grading.md`);
  writeFileSync(out, L.join('\n'));
  console.log(out, '| 발동', a.advice.rules.map((x) => x.id).join(' '));
}
