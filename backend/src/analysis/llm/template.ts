// 템플릿 문장 (ai_spec 2-6): LLM 실패·검증 실패 때 쓰는 대체 문장.
// 숫자는 facts의 display[0]을 그대로 넣어 검증기를 항상 통과한다 (테스트로 확인).
import { isReversed, type FactSheet, type Slot } from './facts.js';
import type { SlotText } from './verify.js';

export const LANING_UNAVAILABLE_TEXT = '이 판은 라인전 상대를 비교할 수 없었습니다.';

type Pick = (id: string) => string;

function picker(sheet: FactSheet, used: string[]): Pick {
  return (id: string) => {
    const f = sheet.byId.get(id);
    if (!f) throw new Error(`템플릿이 쓰는 fact가 없음: ${id}`);
    if (!used.includes(id)) used.push(id);
    // 분은 첫 표기(소수 첫째 자리), 정수는 쉼표 표기, 소수는 원래 값
    if (typeof f.value === 'number' && f.unit !== '분' && Number.isInteger(f.value)) return f.display[f.display.length - 1]!;
    return f.display[0]!;
  };
}

const has = (sheet: FactSheet, id: string) => sheet.byId.has(id);

/**
 * 숫자 뒤 조사 "로/으로". 한국어 읽기의 끝소리로 고른다.
 * 끝자리 1·2·4·5·7·8·9는 "로"(받침 없음·ㄹ), 3·6은 "으로"(삼·육), 0은 영·십·백·천·만 모두 받침이라 "으로".
 */
export function ro(num: string): string {
  const digits = num.replace(/[^0-9.]/g, '');
  const last = digits.at(-1);
  return last === '3' || last === '6' || last === '0' ? '으로' : '로';
}

/** 과목 × 방향 템플릿. 쓸 fact가 없으면 숫자 없는 문장 */
function subjectText(sheet: FactSheet, subjectId: string, good: boolean, p: Pick): string {
  const opp = () => p('laning.opponent');
  const ref = () => p('laning.referenceMin');
  switch (subjectId) {
    case 'laning.gold':
      return `${ref()}분 골드가 상대 ${opp()}보다 ${p('laning.gold.diffAbs')} ${good ? '많았습니다' : '적었습니다'}.`;
    case 'laning.level':
      return `${ref()}분 레벨이 상대 ${opp()}보다 ${p('laning.level.diffAbs')} ${good ? '높았습니다' : '낮았습니다'}.`;
    case 'laning.kda':
      return `${ref()}분까지 ${p('laning.kda.formula')}이 ${p('laning.kda.me')}${ro(p('laning.kda.me'))} 상대 ${opp()}의 ${p('laning.kda.enemy')}보다 ${good ? '좋았습니다' : '나빴습니다'}.`;
    case 'laning.cs':
      return `${ref()}분 CS가 상대 ${opp()}보다 ${p('laning.cs.diffAbs')}개 ${good ? '많았습니다' : '적었습니다'}.`;
    case 'fight.advantage':
      return `낀 오브젝트 싸움의 득실에서 우리 팀 몫이 ${p('fight.advantage.sharePct')}%${good ? '로 컸습니다' : '에 그쳤습니다'}.`;
    case 'fight.damage': {
      const d0 = has(sheet, 'fight.damage.diff0Abs') ? Number(sheet.byId.get('fight.damage.diff0Abs')!.value) : -1;
      const d1 = has(sheet, 'fight.damage.diff1Abs') ? Number(sheet.byId.get('fight.damage.diff1Abs')!.value) : -1;
      const word = good ? '높았습니다' : '낮았습니다';
      if (d1 >= d0 && d1 >= 0) {
        return `${p('fight.damage.phase1StartMin')}분 이후 챔피언 딜 비중이 ${p('fight.damage.share1')}%로 이 유형의 기대치 ${p('fight.damage.expected1')}%보다 ${word}.`;
      }
      if (d0 >= 0) {
        return `${p('fight.damage.phase0EndMin')}분까지 챔피언 딜 비중이 ${p('fight.damage.share0')}%로 이 유형의 기대치 ${p('fight.damage.expected0')}%보다 ${word}.`;
      }
      return `챔피언 딜 비중이 이 유형의 기대치보다 ${word}.`;
    }
    case 'fight.vision':
      return `오브젝트 싸움 직전 시야 점수가 오브젝트당 ${p('fight.vision.perObjective')}${ro(p('fight.vision.perObjective'))} ${good ? '높았습니다' : '낮았습니다'}.`;
    case 'fight.objective':
      return good
        ? `오브젝트 막타를 ${p('fight.objective.lastHits')}번 챙겼습니다.`
        : `오브젝트 막타를 거의 챙기지 못했습니다.`;
    case 'macro.advantage':
      return `오브젝트 밖 싸움의 득실에서 우리 팀 몫이 ${p('macro.advantage.sharePct')}%${good ? '로 컸습니다' : '에 그쳤습니다'}.`;
    case 'macro.solo':
      return `단독 킬 ${p('macro.solo.kills')}번, 단독 데스 ${p('macro.solo.deaths')}번으로 혼자 싸운 결과가 ${good ? '좋았습니다' : '나빴습니다'}.`;
    case 'macro.side':
      return `분당 포탑 피해량이 ${p('macro.side.perMinute')}${ro(p('macro.side.perMinute'))} 사이드 압박이 ${good ? '좋았습니다' : '약했습니다'}.`;
    case 'macro.farm':
      return `중후반 분당 CS가 ${p('macro.farm.perMinute')}개로 ${good ? '많았습니다' : '적었습니다'}.`;
    case 'macro.vision':
      return `분당 시야 점수가 ${p('macro.vision.perMinute')}${ro(p('macro.vision.perMinute'))} ${good ? '높았습니다' : '낮았습니다'}.`;
    default:
      return good ? '이 부분은 잘했습니다.' : '이 부분은 아쉬웠습니다.';
  }
}

const VERDICT_MID: Record<string, string> = { 우세: '우세였고', 열세: '열세였고', 비슷: '비슷했고', 잘함: '잘했고', 보통: '보통이었고', 부족: '부족했고' };
const VERDICT_END: Record<string, string> = { 우세: '우세였습니다', 열세: '열세였습니다', 비슷: '비슷했습니다', 잘함: '잘했습니다', 보통: '보통이었습니다', 부족: '부족했습니다' };

function keyMomentText(sheet: FactSheet, index: number, p: Pick, withFollowUp: boolean): string {
  const km = sheet.result.keyMoments[index]!;
  const k = `keyMoment.${index}`;
  let s: string;
  if (isReversed(km.goldDiffBefore, km.goldDiffAfter)) {
    // 역전: 격차 변화(|뒤|−|앞|) 대신 앞선 팀이 바뀐 것과 우리 팀 기준 손익을 쓴다 (Q1)
    const side = km.swing > 0 ? '이득을' : '손해를';
    s = `${p(`${k}.startMin`)}분 킬 ${p(`${k}.kills`)}개가 난 싸움 뒤 골드가 앞선 팀이 ${p(`${k}.leaderBefore`)}에서 ${p(`${k}.leaderAfter`)}으로 바뀌었고, 우리 팀이 골드 ${p(`${k}.swingAbs`)} ${side} 봤습니다.`;
  } else {
    const dir = km.direction === 'widened' ? '벌어졌습니다' : '좁혀졌습니다';
    s = `${p(`${k}.startMin`)}분 킬 ${p(`${k}.kills`)}개가 난 싸움 뒤 골드 격차가 ${p(`${k}.gapChangeAbs`)} ${dir}.`;
  }
  if (withFollowUp && has(sheet, `${k}.followUp.0`)) s += ` 이어서 ${p(`${k}.followUp.0`)}.`;
  return s;
}

function summaryText(sheet: FactSheet, p: Pick): string {
  const v = sheet.result.summary;
  const parts: [string, string | null][] = [
    ['라인전은', v.laning],
    ['오브젝트 싸움은', v.fight],
    ['그 밖의 운영은', v.macro],
  ];
  const known = parts.filter(([, x]) => x !== null) as [string, string][];
  let first = known.map(([n, x], i) => `${n} ${i === known.length - 1 ? VERDICT_END[x] : VERDICT_MID[x]}`).join(', ');
  if (known.length === 0) first = '이 판은 영역별 판정을 내릴 수 없었습니다';
  let s = `${first}.`;
  if (v.keyMomentIndex !== null && sheet.result.keyMoments[v.keyMomentIndex]) {
    s += ` ${keyMomentText(sheet, v.keyMomentIndex, p, false)}`;
  }
  return s;
}

/** 칸 하나의 템플릿 문장 */
export function templateFor(sheet: FactSheet, slot: Slot): SlotText {
  const used: string[] = [];
  const p = picker(sheet, used);
  let text: string;
  if (slot.area === 'summary') text = summaryText(sheet, p);
  else if (slot.area === 'keyMoment') text = keyMomentText(sheet, slot.index!, p, true);
  else text = subjectText(sheet, slot.subjectId!, slot.kind === 'good', p);
  return { text, factIds: used };
}
