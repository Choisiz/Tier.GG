// Q5 B 0원 확인(Q6: 칭찬 규칙 P1~P4 줄 추가, Q7: R12는 오브젝트 · 딜량): 사용자 판단 틀 항목마다 "말함(어느 칸, 어떻게) / 빠짐(이유) / 해당 없음"을 표로 만든다.
// facts.ts가 정한 칸(등급 과목·빈 칸 채움·합침)과 coverage.planItems의 재료·넘친 과목을 읽기만 한다. 판정에 쓰지 않는다.
import { FRAMEWORK_AREA, FRAMEWORK_LABEL, frameworkLabel, ruleFramework, subjectFramework, type FrameworkKey } from '../coverage.js';
import { PRAISE } from '../rules.js';
import type { FactSheet } from './facts.js';
import { SUBJECT_LABEL } from './labels.js';

export interface CoverageRow {
  /** 판단 틀 이름 (기존 과목은 "기존 과목 · 과목 이름 (규칙)") */
  framework: string;
  status: '말함' | '빠짐' | '해당 없음';
  /** 말한 칸 (예: laning.bad.1) */
  slot: string | null;
  /** 어떻게 말했나 / 왜 빠졌나 */
  detail: string;
}

const name = (id: string) => SUBJECT_LABEL[id] ?? id;
const ORDER = Object.keys(FRAMEWORK_LABEL) as Exclude<FrameworkKey, 'existing'>[];
const ORIGIN_TEXT = { graded: '등급 과목 칸', rule: '규칙으로 빈 칸 채움', material: '재료로 빈 칸 채움' } as const;

export function coverageRows(sheet: FactSheet): CoverageRow[] {
  const r = sheet.result;
  const rows: CoverageRow[] = [];
  const items = sheet.slots.filter((s) => s.area !== 'summary' && s.area !== 'keyMoment');
  for (const key of ORDER) {
    const label = FRAMEWORK_LABEL[key];
    if (key === 'macro.gold') {
      rows.push(r.keyMoments.length > 0 ? { framework: label, status: '말함', slot: 'keyMoment', detail: `결정적 장면 ${r.keyMoments.length}개 (+ 요약)` } : { framework: label, status: '해당 없음', slot: null, detail: '결정적 장면 없음' });
      continue;
    }
    if (FRAMEWORK_AREA[key] === 'laning' && r.laning === null) {
      rows.push({ framework: label, status: '해당 없음', slot: null, detail: '라인전 비교 불가' });
      continue;
    }
    const spoken: string[] = [];
    let slot: string | null = null;
    for (const s of items) {
      const bySubject = s.origin !== 'rule' && subjectFramework(s.subjectId!) === key;
      const primary = s.rules.filter((x) => !x.merged && ruleFramework(x) === key).map((x) => x.id);
      const merged = s.rules.filter((x) => x.merged && ruleFramework(x) === key).map((x) => x.id);
      if (!bySubject && primary.length === 0 && merged.length === 0) continue;
      slot ??= s.slot;
      const how = merged.length > 0 && !bySubject && primary.length === 0 ? `합침(${merged.join('·')}) → ${s.subjectId}` : `${ORIGIN_TEXT[s.origin]}${primary.length ? ` ${primary.join('·')}` : ''}${merged.length ? ` + 합침 ${merged.join('·')}` : ''}`;
      spoken.push(`${s.slot} ${how}`);
    }
    if (spoken.length > 0) {
      rows.push({ framework: label, status: '말함', slot, detail: spoken.join(' / ') });
      continue;
    }
    // 빠진 이유
    const drop = sheet.merges.filter((m) => m.slot === null && m.candidate.framework === key);
    const material = sheet.plan.materials.find((m) => m.framework === key);
    const overflow = sheet.plan.overflow.filter((o) => subjectFramework(o.subjectId) === key);
    if (drop.length > 0) rows.push({ framework: label, status: '빠짐', slot: null, detail: drop.map((m) => `${m.candidate.rule.id} ${m.reason}`).join(' / ') });
    else if (material?.status === 'no_slot') rows.push({ framework: label, status: '빠짐', slot: null, detail: material.reason });
    else if (overflow.length > 0) rows.push({ framework: label, status: '빠짐', slot: null, detail: `칸 수 (${overflow.map((o) => `${o.kind === 'good' ? '좋은 점' : '부족한 점'} 3번째 이후`).join(', ')}, 규칙 없음)` });
    else rows.push({ framework: label, status: '해당 없음', slot: null, detail: noneReason(sheet, key) });
  }
  // 기존 과목 규칙 (R1~R5)
  for (const fr of r.advice?.rules ?? []) {
    if (ruleFramework(fr) !== 'existing') continue;
    const label = `${frameworkLabel('existing', name(fr.subjectId))} (${fr.id} ${fr.kind === 'good' ? '좋은 점' : '부족한 점'})`;
    const s = items.find((x) => x.kind === fr.kind && x.rules.some((y) => y.id === fr.id && y.subjectId === fr.subjectId));
    if (s) {
      const merged = s.rules.find((y) => y.id === fr.id && y.subjectId === fr.subjectId)!.merged;
      rows.push({ framework: label, status: '말함', slot: s.slot, detail: merged ? `합침 → ${s.subjectId}` : ORIGIN_TEXT[s.origin] });
      continue;
    }
    const m = sheet.merges.find((x) => x.slot === null && x.candidate.rule === fr);
    rows.push({ framework: label, status: '빠짐', slot: null, detail: m ? m.reason : '칸 없음' });
  }
  return rows;
}

function noneReason(sheet: FactSheet, key: FrameworkKey): string {
  const r = sheet.result;
  const grade = (id: string) => [...r.fight.subjects, ...r.macro.subjects].find((x) => x.id === id)?.grade ?? null;
  switch (key) {
    case 'laning.growth':
      return `칸 "${r.laning?.cell.label}" (말하지 않는 칸)`;
    case 'laning.deaths':
      return '비교 시점 전 데스 없음';
    case 'laning.roam':
      return r.laning?.roam ? '라인 밖 관여 비슷' : '정글 (라인 밖 관여 없음)';
    case 'fight.damage': {
      // Q7: 오브젝트 싸움 내 기여 낮음(R12)도 이 판단 틀
      const c = r.scenes?.objectiveContribution;
      return `딜 비중 등급 ${grade('fight.damage') ?? '없음'} (말하지 않음), R12 발동 안 함 (${c ? `내 관여 ${String(c.involvementPct)}%·피해 몫 ${String(c.killedDamagePct)}%` : '오브젝트 싸움 없음'})`;
    }
    case 'fight.survive':
      return 'R10 발동 안 함';
    case 'fight.vision':
      return `시야 등급 ${grade('fight.vision') ?? '없음'}, R11 발동 안 함`;
    case 'fight.initiate':
    case 'macro.roam':
      return sheet.plan.materials.find((m) => m.framework === key)?.reason ?? '재료 없음';
    // Q6 칭찬 규칙: 왜 발동하지 않았나 (확정 값)
    case 'praise.carry': {
      const td = r.scenes?.teamDamage;
      const dmg = [...r.fight.subjects].find((x) => x.id === 'fight.damage')?.facts ?? {};
      const diffs = [0, 1, 2].map((k) => dmg[`diff${k}`]).filter((x): x is number => typeof x === 'number');
      return `P1 발동 안 함 (팀 딜 ${td ? `${td.rank}위` : '순위 없음'}, 가장 높은 구간 차이 ${diffs.length ? `${Math.max(...diffs)}%p` : '없음'})`;
    }
    case 'praise.solo':
      return `P2 발동 안 함 (1:1 킬 ${r.scenes?.soloKills.length ?? 0}번)`;
    case 'praise.late': {
      const late = (r.scenes?.soloKills ?? []).filter((k) => k.sec >= PRAISE.lateSec).length;
      const dmg = [...r.fight.subjects].find((x) => x.id === 'fight.damage')?.facts ?? {};
      return `P3 발동 안 함 (30분 이후 1:1 킬 ${late}번, 30분 이후 딜 비중 ${typeof dmg.share2 === 'number' ? `${dmg.share2}%(기대 ${String(dmg.expected2)}%)` : '구간 없음'})`;
    }
    case 'praise.objective': {
      const adv = [...r.fight.subjects].find((x) => x.id === 'fight.advantage');
      return `P4 발동 안 함 (득실 등급 ${adv?.grade ?? '없음'}, 참여 싸움 ${String(adv?.facts.fights ?? 0)}번)`;
    }
    default:
      return '해당 없음';
  }
}
