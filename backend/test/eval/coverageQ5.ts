// Q5 0원 확인: 세트 폴더의 판마다 사용자 판단 틀 항목별 "말함 / 빠짐(이유) / 해당 없음" 표와 칸별 템플릿 문장(검증 결과)을 md로 찍는다.
// Q6: 판마다 발동한 칭찬 규칙(P1~P4) 한 줄과 판단 틀 표의 칭찬 줄. --summary면 판마다 칭찬 규칙 표 한 줄만.
// Q7: P4는 두 팀 점수, 오브젝트 싸움 내 기여(확정 값)와 R12 한 줄을 더한다.
// 엔진 + 템플릿만 쓴다 (LLM·DB·네트워크 없음).
// 사용: node --import tsx test/eval/coverageQ5.ts --set test/eval/ahri2 --set test/eval/recent3
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { frameworkLabelsOf } from '../../src/analysis/coverage.js';
import { allChampionNames, championNamesFromJson } from '../../src/analysis/feedback.js';
import { analyzeMatch, championTagsFromJson } from '../../src/analysis/index.js';
import { coverageRows } from '../../src/analysis/llm/coverageReport.js';
import { buildFacts } from '../../src/analysis/llm/facts.js';
import { SUBJECT_LABEL } from '../../src/analysis/llm/labels.js';
import { templateFor } from '../../src/analysis/llm/template.js';
import { verifySlot } from '../../src/analysis/llm/verify.js';
import type { AnalysisMatch, AnalysisTimeline } from '../../src/analysis/types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

interface SetFile {
  items: { matchId: string; match: string; timeline: string; participantId: number; note?: string }[];
}

const { values } = parseArgs({ options: { set: { type: 'string', multiple: true }, summary: { type: 'boolean', default: false } } });
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
/** Q6 발동한 칭찬 규칙 한 줄 (확정 값만) */
function praiseLine(result: ReturnType<typeof analyzeMatch>): string {
  const ps = result.advice.rules.filter((r) => r.id.startsWith('P'));
  if (ps.length === 0) return '없음';
  return ps
    .map((r) => {
      const f = r.facts;
      if (r.id === 'P1') return `P1 팀 딜 1위(${String(f.teamSharePct)}%) · 구간${String(f.phase)} ${String(f.share)}% (기대 ${String(f.expected)}, +${String(f.diff)}%p)`;
      if (r.id === 'P2') return `P2 1:1 킬 ${String(f.count)}번 (${(f.secs as number[]).map(mmss).join('·')})`;
      if (r.id === 'P3' && f.basis === 'damage') return `P3(딜) 30분 이후 ${String(f.share2)}% (기대 ${String(f.expected)}, +${String(f.diff)}%p)${f.laningWeak ? ' · 라인전 열세' : ''}`;
      if (r.id === 'P3') return `P3(킬) 30분 이후 1:1 킬 ${String(f.lateCount)}번`;
      return `P4 오브젝트 싸움 ${String(f.fights)}번 · 우리 팀 ${String(f.ours)}점 대 상대 팀 ${String(f.theirs)}점`;
    })
    .join(' / ');
}
/** Q7 오브젝트 싸움 내 기여 한 줄 (확정 값) + R12 발동 */
function contributionLine(result: ReturnType<typeof analyzeMatch>): string {
  const c = result.scenes.objectiveContribution;
  if (!c) return '오브젝트 싸움 참여 없음';
  const lv = (x: string | null) => (x === null ? '판단 안 함' : x === 'HIGH' ? '높음' : x === 'LOW' ? '낮음' : '보통');
  const r12 = result.advice.rules.some((r) => r.id === 'R12') ? ' · **R12**' : '';
  return `${c.fights}번 · 킬 관여 ${c.myKills + c.myAssists}/${c.teamKills} = ${String(c.involvementPct)}%(${lv(c.involvementLevel)}) · 피해 몫 ${String(c.killedDamagePct)}%(${lv(c.killedDamageLevel)}) · 킬 ${c.myKillPoints}점 대 데스 ${c.myDeathPoints}점 · 막타 ${c.lastHits.length}${r12}`;
}
const tagsJson = readJson<unknown>(join(ROOT, 'test/fixtures/ddragon/champion-tags.json'));
const tags = championTagsFromJson(tagsJson);
const names = championNamesFromJson(tagsJson);
const all = allChampionNames(names);
const out: string[] = [];
for (const dir of values.set ?? []) {
  const setDir = resolve(dir);
  const set = readJson<SetFile>(join(setDir, 'set.json'));
  for (const it of set.items) {
    const match = readJson<AnalysisMatch>(resolve(setDir, it.match));
    const timeline = readJson<AnalysisTimeline>(resolve(setDir, it.timeline));
    const puuid = match.info.participants.find((p) => p.participantId === it.participantId)!.puuid;
    const result = analyzeMatch({ match, timeline, puuid, championTags: tags });
    const sheet = buildFacts(result, names);
    if (values.summary) {
      out.push(`| ${it.matchId} p${it.participantId} ${names.get(result.player.championId) ?? ''} | ${result.player.win ? '승' : '패'} | ${praiseLine(result)} | ${contributionLine(result)} |`);
      continue;
    }
    out.push(`### ${it.matchId} p${it.participantId} ${names.get(result.player.championId) ?? ''} (${it.note ?? ''})`, '', `- 칭찬 규칙: ${praiseLine(result)}`, `- 오브젝트 싸움 내 기여(Q7): ${contributionLine(result)}`, '');
    out.push('| 판단 틀 | 결과 | 칸 | 어떻게 / 이유 |', '|---|---|---|---|');
    for (const row of coverageRows(sheet)) out.push(`| ${row.framework} | ${row.status} | ${row.slot ?? '-'} | ${row.detail} |`);
    out.push('', '| 칸 | 판단 틀 | 규칙 | 템플릿 문장 (글자 수) | 검증 |', '|---|---|---|---|---|');
    for (const s of sheet.slots) {
      const t = templateFor(sheet, s);
      const fails = verifySlot(s, t, { sheet, allChampionNames: all });
      const fw = s.area === 'summary' ? '요약' : s.area === 'keyMoment' ? '교전 · 골드 격차' : frameworkLabelsOf({ subjectId: s.subjectId!, origin: s.origin, rules: s.rules }, (id) => SUBJECT_LABEL[id] ?? id).join(' / ');
      const rules = s.rules.map((r) => `${r.id}${r.merged ? '(합침)' : ''}`).join(' ') || '-';
      out.push(`| ${s.slot} | ${fw} | ${rules} | ${t.text.replace(/\|/g, '/')} (${t.text.length}) | ${fails.length === 0 ? '통과' : fails.map((f) => f.rule).join(',')} |`);
    }
    out.push('');
  }
}
console.log(out.join('\n'));
