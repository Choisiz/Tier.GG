// 템플릿 문장 (ai_spec 2-6): LLM 실패·검증 실패 때 쓰는 대체 문장.
// 숫자는 facts의 display[0]을 그대로 넣어 검증기를 항상 통과한다 (테스트로 확인).
// 시각은 분:초("15:06")로 쓴다 (Q3). 조언 문장은 넣지 않는다: 규칙이 발동한 칸이라도 템플릿은 결과·장면만 (Q3 "템플릿(조언 없음)").
// Q4: 라인전은 2-1 칸·원인 1위, 데스 유형, 라인 밖 관여로 쓴다. 추정 fact는 템플릿에 쓰지 않는다(확정 값만).
// Q5: 규칙으로 채운 칸(origin rule)은 규칙 근거 문장, 재료 칸(이니시·라인 밖 KDA)은 그 사실, 합친 규칙(merged)은 사실 한 문장을 덧붙인다.
// Q6: 칭찬 규칙(P1~P4)이 붙은 좋은 점 칸은 과목 문장 대신 칭찬 문장(확정 값, 말투 ① 담백 + 게임 용어: "캐리했습니다", "게임을 주도했습니다").
// Q7(사용자 채점 2026-11-24): 라인 밖 칸 = 전체 킬 관여 → 그 킬이 어디서 났나 / 득실 = 몫(%) 대신 두 팀 점수와 결과 /
// P4 = 그 싸움들에서 내 기여(확정 값) / 딜 = 팀 전체 1위와 구간 추이를 나누고 "미드 딜러 평균"처럼 포지션 이름, 비중은 소수 첫째 자리.
import { isPraise } from '../praise.js';
import { isReversed, TIME_UNIT, type FactSheet, type Slot, type SlotRule } from './facts.js';
import { LIMITS, sentenceCount, type SlotText } from './verify.js';

export const LANING_UNAVAILABLE_TEXT = '이 판은 라인전 상대를 비교할 수 없었습니다.';

type Pick = (id: string) => string;

function picker(sheet: FactSheet, used: string[]): Pick {
  return (id: string) => {
    const f = sheet.byId.get(id);
    if (!f) throw new Error(`템플릿이 쓰는 fact가 없음: ${id}`);
    if (!used.includes(id)) used.push(id);
    // 시각은 분:초 표기, 정수는 쉼표 표기, 소수는 원래 값
    if (typeof f.value === 'number' && f.unit !== TIME_UNIT && Number.isInteger(f.value)) return f.display[f.display.length - 1]!;
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

/** 받침 있으면 a, 없으면 b (한글 끝 글자 기준. 한글이 아니면 b) */
function josa(word: string, a: string, b: string): string {
  const c = word.trim().at(-1)?.charCodeAt(0) ?? 0;
  if (c < 0xac00 || c > 0xd7a3) return b;
  return (c - 0xac00) % 28 === 0 ? b : a;
}
/** "로/으로" (받침 없음·ㄹ받침 → 로) */
function euro(word: string): string {
  const c = word.trim().at(-1)?.charCodeAt(0) ?? 0;
  if (c < 0xac00 || c > 0xd7a3) return '로';
  const jong = (c - 0xac00) % 28;
  return jong === 0 || jong === 8 ? '로' : '으로';
}

/** 첫 장면 문장 (Q2). 장면이 없으면 빈 문자열. 방향 단어를 쓰지 않는 중립 문장 */
function sceneSentence(sheet: FactSheet, subjectId: string, good: boolean, p: Pick): string {
  const k = `scene.${subjectId}.0`;
  if (!has(sheet, `${k}.min`)) return '';
  const where = has(sheet, `${k}.region`) ? ` ${p(`${k}.region`)}에서` : '';
  switch (subjectId) {
    case 'fight.vision':
      return ` ${p(`${k}.min`)}에 잡힌 ${p(`${k}.objective`)} 전 ${p('fight.vision.windowSec')}초 동안 내가 설치한 와드는 ${p(`${k}.wardsPlaced`)}개였습니다.`;
    case 'fight.objective':
      return good && sheet.byId.get(`${k}.lastHit`)?.value === '내가 막타를 침'
        ? ` ${p(`${k}.min`)}에 ${p(`${k}.objective`)} 막타를 직접 쳤습니다.`
        : ` ${p(`${k}.min`)}에 ${p(`${k}.objective`)}은 ${p(`${k}.taken`).replace('잡음', '잡았습니다')}.`;
    case 'fight.advantage':
    case 'macro.advantage':
      return ` ${p(`${k}.min`)}에${where} 난 싸움은 우리 팀 ${p(`${k}.killsOurs`)}킬, 상대 팀 ${p(`${k}.killsTheirs`)}킬이었습니다.`;
    case 'macro.solo':
      return ` ${p(`${k}.min`)}에${where} ${p(`${k}.what`)} 장면이 있었습니다.`;
    default:
      return '';
  }
}

/** 과목 × 방향 템플릿. 쓸 fact가 없으면 숫자 없는 문장 */
function subjectText(sheet: FactSheet, subjectId: string, good: boolean, p: Pick): string {
  return subjectMain(sheet, subjectId, good, p) + sceneSentence(sheet, subjectId, good, p);
}

// ---------- Q5 B: 규칙으로 채운 칸·재료 칸·합친 규칙 ----------

/** 규칙 하나가 있었다는 사실 문장 (조언 없음, 확정 값만). 규칙으로 채운 칸의 본문과 합친 규칙 문장에 쓴다 */
export function ruleSentence(sheet: FactSheet, r: SlotRule, p: Pick, compact = false): string {
  const at = (id: string) => (has(sheet, id) ? p(id) : null);
  switch (r.id) {
    case 'R1': {
      const q = `rule.R1.${r.subjectId}`;
      // 이름 속 숫자("15분 이후 분당 CS")는 숫자 검사에 걸리므로 "중후반"으로
      const label = (sheet.byId.get(`${q}.me`)?.label.replace(/\s*\(나\)$/, '') ?? '이 과목').replace(/\d+분 이후\s*/, '중후반 ');
      const unit = sheet.byId.get(`${q}.me`)?.unit === '%' ? '%' : '';
      const opp = at(`${q}.opponent`);
      const me = p(`${q}.me`);
      const by = unit ? '로' : ro(me);
      return opp !== null ? `${label}${josa(label, '은', '는')} 나 ${me}${unit}${by} 상대 라이너 ${opp}${unit}보다 낮았습니다.` : `${label}${josa(label, '은', '는')} ${me}${unit}${by} 낮았습니다.`;
    }
    case 'R2':
    case 'R3':
      return `오브젝트 싸움에서 내 데스 ${p(`rule.${r.id}.myDeaths`)}번으로 상대 팀이 득실 점수 ${p(`rule.${r.id}.deathPoints`)}점을 얻었습니다.`;
    case 'R4': {
      const q = `rule.R4.${r.required.some((id) => id.startsWith('rule.R4.good')) ? 'good' : 'bad'}`;
      const won = sheet.byId.get(`${q}.outcome`)?.value === '우리 팀이 더 얻음';
      const min = at(`${q}.min`);
      // R4 문장 속 숫자(데스 수·점수·오브젝트 점수)의 fact를 factIds에 올린다
      for (const k of ['myDeaths', 'deathPoints', 'objectivePoints', 'objective']) if (r.required.includes(`${q}.${k}`)) p(`${q}.${k}`);
      return `${min !== null ? `${min} ` : ''}싸움은 ${won ? '우리 팀이 더 얻었고' : '상대 팀이 더 얻었고'}, ${r.text}.`;
    }
    case 'R5': {
      const where = has(sheet, 'rule.R5.region') ? ` ${p('rule.R5.region')}에서` : '';
      return `${p('rule.R5.deathMin')}에${where} 단독 데스가 있었습니다.`;
    }
    case 'R6': {
      const where = has(sheet, 'rule.R6.region') ? ` ${p('rule.R6.region')}에서` : '';
      return `${p('rule.R6.min')}에${where} 상대 라이너에게 1:1로 죽었습니다.`;
    }
    case 'R7': {
      const where = has(sheet, 'rule.R7.region') ? ` ${p('rule.R7.region')}에서` : '';
      const j = at('rule.R7.jungler');
      return `${p('rule.R7.min')}에${where} ${j !== null ? `${j}${josa(j, '이', '가')} 관여한 ` : ''}갱에 죽었습니다.`;
    }
    case 'R8': {
      const me = p('rule.R8.me');
      const enemy = p('rule.R8.enemy');
      const unit = sheet.byId.get('rule.R8.me')?.unit ?? '';
      const cause = String(sheet.byId.get('rule.R8.cause')?.value ?? '원인');
      const u = unit === '골드' ? '골드' : unit === '개' ? '개' : unit === '번' ? '번' : '';
      return `라인전 골드 차의 가장 큰 원인은 ${cause}${euro(cause)} 나 ${me}${u}, 상대 ${enemy}${u}${josa(u, '이었습니다', '였습니다')}.`;
    }
    case 'R9': {
      const opp = at('laning.opponent');
      // 합친 문장은 칸 안에 비교 시점이 이미 있어 시각을 뺀다
      const when = !compact && has(sheet, 'laning.referenceMin') ? `${p('laning.referenceMin')}까지 ` : '';
      return `${when}다른 라인·정글 싸움 킬·어시스트는 나 ${p('rule.R9.me')}번, 상대${opp !== null ? ` ${opp}` : ''} ${p('rule.R9.enemy')}번이었습니다.`;
    }
    case 'R10':
      return `${p('rule.R10.deathMin')}에 오브젝트 싸움 첫 킬 뒤 ${p('rule.R10.afterSec')}초 만에 죽었습니다.`;
    case 'R11': {
      const obj = p('rule.R11.objective');
      return `${p('rule.R11.min')}에 상대 팀이 잡은 ${obj} 전 ${p('rule.R11.windowSec')}초 동안 내 제어 와드는 ${p('rule.R11.controlWards')}개였습니다.`;
    }
    case 'R12':
      return r12Sentence(sheet, r, p, compact);
    case 'P1':
    case 'P2':
    case 'P3':
    case 'P4':
      return praiseSentence(sheet, r, p, compact ? 'compact' : 'full', []);
  }
}

// ---------- Q7 오브젝트 싸움 두 팀 점수 · 내 기여 ----------

/** 두 팀 점수 결과 말 → 문장 끝 */
const OUTCOME_END: Readonly<Record<string, string>> = { '크게 이김': '크게 이겼습니다', 이김: '이겼습니다', 비슷함: '비슷했습니다', 짐: '졌습니다', '크게 짐': '크게 졌습니다' };

/**
 * 두 팀 점수 문장 (몫 % 대신, 사용자 채점 2026-11-24): "내가 참여한 싸움 8번에서 킬·포탑·오브젝트를 점수로 합치면 우리 팀 363점, 상대 팀 76점으로 크게 이겼습니다."
 * q = facts 접두어(fight.advantage | macro.advantage | rule.P4), withWindow = 기준 시간(앞뒤 40초)을 쓰나
 */
function pointsSentence(sheet: FactSheet, q: string, p: Pick, opts: { fightsId: string; inside: boolean; withWindow: boolean }): string {
  const outcome = String(sheet.byId.get(`${q}.outcome`)?.value ?? '');
  const end = OUTCOME_END[outcome] ?? '끝났습니다';
  const n = p(opts.fightsId);
  const w = opts.withWindow && has(sheet, 'fight.windowSec') ? p('fight.windowSec') : null;
  const head =
    w !== null
      ? `오브젝트를 잡은 시각 앞뒤 ${w}초 ${opts.inside ? '동안' : '밖에서'} 내가 참여한 싸움 ${n}번에서`
      : opts.inside
        ? `내가 참여한 오브젝트 싸움 ${n}번에서`
        : `오브젝트 싸움 밖에서 내가 참여한 싸움 ${n}번에서`;
  const what = opts.inside ? '킬·포탑·오브젝트' : '킬·포탑';
  return `${head} ${what}${josa(what, '을', '를')} 점수로 합치면 우리 팀 ${p(`${q}.ours`)}점, 상대 팀 ${p(`${q}.theirs`)}점으로 ${end}.`;
}

/**
 * 내 기여 절들 (확정 값). r의 required에 든 값(P4 = 높았던 값, R12 = 낮았던 값)만 방향 말을 붙이고, 나머지는 사실만.
 * form = full(관여·피해 몫 둘 다) | short(required 값만, 없으면 관여 하나). 끝맺음 없는 절 목록을 돌려준다
 */
function contributionClauses(sheet: FactSheet, r: SlotRule, p: Pick, form: 'full' | 'short'): string[] {
  const q = `rule.${r.id}`;
  const flagged = (k: string) => r.required.includes(`${q}.${k}`);
  const high = r.id === 'P4';
  const hasInv = has(sheet, `${q}.involvementPct`);
  const hasDmg = has(sheet, `${q}.killedDamagePct`);
  const none = !flagged('involvementPct') && !flagged('killedDamagePct');
  // short: 규칙이 짚는 값만, 짚는 값이 없으면(P4 보통) 관여 하나(없으면 피해 몫)
  const invOn = hasInv && (form === 'full' || flagged('involvementPct') || none);
  const dmgOn = hasDmg && (form === 'full' || flagged('killedDamagePct') || (none && !hasInv));
  const out: string[] = [];
  if (invOn) {
    const tk = p(`${q}.teamKills`);
    const n = p(`${q}.involvement`);
    const pct = p(`${q}.involvementPct`);
    if (!flagged('involvementPct')) out.push(`우리 팀 킬 ${tk}번 중 ${n}번(${pct}%)에 관여했`);
    else out.push(high ? `우리 팀 킬 ${tk}번 중 ${n}번(${pct}%)에 관여해 대부분의 킬에 함께했` : `우리 팀 킬 ${tk}번 중 내 관여는 ${n}번(${pct}%)에 그쳤`);
  }
  if (dmgOn) {
    const d = p(`${q}.killedDamagePct`);
    if (!flagged('killedDamagePct')) out.push(`잡은 상대가 죽기 전 받은 챔피언 피해 중 내 몫은 ${d}%였`);
    else out.push(high ? `잡은 상대가 죽기 전 받은 챔피언 피해 중 ${d}%를 내가 넣어 크게 보탰` : `잡은 상대가 죽기 전 받은 챔피언 피해 중 내 몫은 ${d}%로 낮았`);
  }
  return out;
}

/** 절들을 한 문장으로 ("~고, ~습니다.") */
const joinClauses = (xs: readonly string[]): string => (xs.length === 0 ? '' : `${xs.slice(0, -1).map((x) => `${x}고, `).join('')}${xs[xs.length - 1]}습니다.`);

/**
 * P4 문장: 두 팀 점수와 결과 + 그 싸움들에서 내 기여.
 * full = 두 문장(기준 시간 + 점수 / 기여 둘 다), compact = 한 문장(점수와 결과 + 높았던 기여, 없으면 관여)
 */
function p4Sentence(sheet: FactSheet, r: SlotRule, p: Pick, form: 'full' | 'compact' | 'bare'): string {
  if (form === 'full') {
    const c = joinClauses(contributionClauses(sheet, r, p, 'full'));
    const points = pointsSentence(sheet, 'rule.P4', p, { fightsId: 'rule.P4.fights', inside: true, withWindow: true });
    return c ? `${points} 그 싸움들에서 ${c}` : points;
  }
  const end = (OUTCOME_END[String(sheet.byId.get('rule.P4.outcome')?.value ?? '')] ?? '끝났습니다').replace(/습니다$/, '고');
  const head = `내가 참여한 오브젝트 싸움 ${p('rule.P4.fights')}번은 킬·포탑·오브젝트 점수로 우리 팀 ${p('rule.P4.ours')}점, 상대 팀 ${p('rule.P4.theirs')}점으로 ${end}`;
  // bare = 점수와 결과만 (높았던 기여가 없을 때만 쓴다: 높았던 기여는 required라 빠지면 검증 실패)
  const c = form === 'bare' ? [] : contributionClauses(sheet, r, p, 'short');
  return c.length > 0 ? `${head}, ${joinClauses(c)}` : `${head.replace(/고$/, '습니다')}.`;
}

/** R12 (부족한 점): 두 팀 점수와 결과 + 낮았던 내 기여. compact(합친 규칙) = 싸움 수 + 낮은 값만 */
function r12Sentence(sheet: FactSheet, r: SlotRule, p: Pick, compact: boolean): string {
  const q = 'rule.R12';
  const low = joinClauses(contributionClauses(sheet, r, p, 'short'));
  if (compact || !has(sheet, `${q}.ours`)) return `내가 참여한 오브젝트 싸움 ${p(`${q}.fights`)}번에서 ${low}`;
  const outcome = String(sheet.byId.get(`${q}.outcome`)?.value ?? '');
  const ahead = outcome === '크게 이김' || outcome === '이김';
  return `내가 참여한 오브젝트 싸움 ${p(`${q}.fights`)}번에서 우리 팀 ${p(`${q}.ours`)}점, 상대 팀 ${p(`${q}.theirs`)}점으로 ${ahead ? '우리 팀이 앞섰지만' : '끝났고'}, ${low}`;
}

// ---------- Q6 칭찬 문장 ----------

/** 칭찬 규칙 순서 (읽는 순서): 딜 캐리 → 1:1 킬 → 후반 영향력 → 오브젝트 싸움 기여 */
const PRAISE_ORDER = ['P1', 'P2', 'P3', 'P4'];

/**
 * 칭찬 규칙 하나의 문장 (확정 값만, 조언 없음). form = full(칸의 본문) | compact(합친 규칙·길이가 넘칠 때 짧은 꼴).
 * others = 같은 칸의 다른 칭찬 규칙 ID (P1과 P3이 함께면 P3은 기대치를 되풀이하지 않고, P2와 P3이 함께면 "그중 N번")
 */
export function praiseSentence(sheet: FactSheet, r: SlotRule, p: Pick, form: 'full' | 'compact', others: readonly string[]): string {
  const at = (id: string) => (has(sheet, id) ? p(id) : null);
  const val = (id: string) => sheet.byId.get(id)?.value;
  switch (r.id) {
    case 'P1': {
      const team = p('rule.P1.teamSharePct');
      const avg = p('player.roleAverage');
      // 짧은 꼴도 근거(팀 내 비중·그 구간 비중·포지션 평균)는 모두 쓴다
      if (form === 'compact') return `챔피언 딜이 팀에서 가장 많았고(팀 딜의 ${team}%), 딜 비중이 ${p('rule.P1.share')}%로 ${avg} ${p('rule.P1.expected')}%보다 크게 높아 싸움을 캐리했습니다.`;
      const dmg = p('rule.P1.damage');
      // Q7(4): 게임 전체 1위(팀 내 비중)와 구간 비중을 다른 문장으로 나눈다 ("팀 딜 25.5%"와 "30분 이후 30.6%"가 같은 말로 읽히지 않게)
      return `게임 전체 챔피언 딜은 ${dmg}${ro(dmg)} 팀에서 가장 많았고 팀 딜의 ${team}%였습니다. ${p1When(sheet, p)} 딜 비중은 ${p('rule.P1.share')}%로 ${avg} ${p('rule.P1.expected')}%보다 크게 높아 싸움을 캐리했습니다.`;
    }
    case 'P2': {
      const n = p('rule.P2.count');
      if (form === 'compact' || !has(sheet, 'rule.P2.0.min')) return `상대를 1:1로 ${n}번 잡았습니다.`;
      const v = at('rule.P2.0.victim');
      return `${p('rule.P2.0.min')} ${v !== null ? `${v}${josa(v, '을', '를')} ` : ''}시작으로 상대를 1:1로 ${n}번 잡았습니다.`;
    }
    case 'P3': {
      const weak = has(sheet, 'rule.P3.laning');
      if (r.subjectId === 'macro.solo') {
        const late = p('rule.P3.kills.lateMin');
        const n = p('rule.P3.kills.lateCount');
        if (form === 'compact') return `${late} 이후 1:1 킬이 ${n}번이었습니다.`;
        // "라인전은 열세였지만"은 교전 딜 칸 P3이 없을 때만 (두 영역에서 같은 말을 되풀이하지 않게)
        const lane = weak && !sheet.result.advice.rules.some((x) => x.id === 'P3' && x.subjectId === 'fight.damage') ? '라인전은 열세였지만 ' : '';
        const head = others.includes('P2') ? `그중 ${n}번이 ${late} 이후였고,` : `${late} 이후 1:1 킬이 ${n}번으로`;
        return `${head} ${lane}후반으로 갈수록 강해졌습니다.`;
      }
      const s2 = p('rule.P3.damage.share2');
      const late = p('rule.P3.damage.lateMin');
      if (form === 'compact') return `${late} 이후 딜 비중이 ${s2}%로 가장 높아 후반에 게임을 주도했습니다.`;
      const shares = ['share0', 'share1'].filter((k) => has(sheet, `rule.P3.damage.${k}`)).map((k) => `${p(`rule.P3.damage.${k}`)}%`);
      const rising = val('rule.P3.damage.trend') === '구간마다 올랐음';
      // Q7(4): 구간 추이는 화살표로 ("15.8% → 25.3% → 30.6%")
      const trend = `구간 딜 비중이 ${[...shares, `${s2}%`].join(' → ')}로 ${rising ? '후반으로 갈수록 높아졌고' : `${late} 이후가 가장 높았고`}`;
      // P1이 같은 칸에 있으면 포지션 평균은 P1 문장이 말한다
      const exp = others.includes('P1') ? '' : ` ${p('player.roleAverage')} ${p('rule.P3.damage.expected')}%보다 크게 높아`;
      return `${trend},${exp} ${weak ? '라인전은 열세였지만 후반에 뒤집어' : '후반으로 갈수록 강해져'} 게임을 주도했습니다.`;
    }
    case 'P4':
      // Q7(2·3): 몫(%) 대신 두 팀 점수와 결과 + 그 싸움들에서 내 기여(확정 값)
      return p4Sentence(sheet, r, p, form);
    default:
      return '';
  }
}

/** P1 구간 말: 0~15분 "15:00까지", 15~30분 "15:00~30:00", 30분 이후 "30:00 이후" */
function p1When(sheet: FactSheet, p: Pick): string {
  const phase = Number(sheet.byId.get('rule.P1.phase')?.value);
  const start = has(sheet, 'rule.P1.phaseStartMin') ? p('rule.P1.phaseStartMin') : null;
  const end = has(sheet, 'rule.P1.phaseEndMin') ? p('rule.P1.phaseEndMin') : null;
  return phase === 0 && end ? `${end}까지` : end && start ? `${start}~${end}` : start ? `${start} 이후` : '한 구간의';
}

/**
 * P1(딜 캐리)과 교전 P3(후반 딜)이 같은 구간(30분 이후)을 말하면 한 흐름으로: 팀 딜 1위 + 구간 비중 추이 + 기대치 → 주도하며 캐리.
 * 같은 30분 이후 비중은 한 번만 쓰고 P1·P3 두 fact를 모두 인용한다. 다른 구간이면 null (따로 쓴다)
 */
function carryLateText(sheet: FactSheet, p: Pick, form: 'full' | 'compact'): string | null {
  if (Number(sheet.byId.get('rule.P1.phase')?.value) !== 2 || !has(sheet, 'rule.P3.damage.share2')) return null;
  const team = p('rule.P1.teamSharePct');
  const s2 = p('rule.P3.damage.share2');
  p('rule.P1.share'); // 같은 값(30분 이후 비중)이라 문장에는 한 번만
  const exp = p('rule.P1.expected');
  const late = p('rule.P3.damage.lateMin');
  const weak = has(sheet, 'rule.P3.laning');
  const avg = p('player.roleAverage');
  const turn = weak ? '라인전은 열세였지만 후반에 뒤집어' : '후반으로 갈수록 강해져';
  if (form === 'compact') return `챔피언 딜이 팀에서 가장 많았고(팀 딜의 ${team}%), ${late} 이후 딜 비중이 ${s2}%로 ${avg} ${exp}%보다 크게 높았습니다. ${turn} 게임을 주도하며 싸움을 캐리했습니다.`;
  const shares = ['share0', 'share1'].filter((k) => has(sheet, `rule.P3.damage.${k}`)).map((k) => `${p(`rule.P3.damage.${k}`)}%`);
  const rising = sheet.byId.get('rule.P3.damage.trend')?.value === '구간마다 올랐음';
  const dmg = p('rule.P1.damage');
  // Q7(4): ① 게임 전체 1위(팀 내 비중) ② 구간 추이(화살표)와 30분 이후 포지션 평균을 다른 문장으로
  return `게임 전체 챔피언 딜은 ${dmg}${ro(dmg)} 팀에서 가장 많았고 팀 딜의 ${team}%였습니다. 구간 딜 비중은 ${[...shares, `${s2}%`].join(' → ')}로 ${rising ? '올라' : '바뀌어'} ${late} 이후에는 ${avg} ${exp}%보다 크게 높았고, ${turn} 게임을 주도하며 싸움을 캐리했습니다.`;
}

/**
 * 칭찬 규칙이 처음부터 붙은 칸(합친 규칙 제외)의 본문: 칭찬 문장을 읽는 순서로. 칸 길이(170자·3문장)를 넘으면 짧은 꼴로(짧은 꼴도 근거 fact는 모두 쓴다).
 * 칭찬 문장이 과목 문장(예: 딜 비중·득실 몫·단독 킬)을 대신한다 — 운영 "단독 킬"(6-1)과 1:1 킬은 정의가 달라 섞지 않는다.
 */
function praiseText(sheet: FactSheet, praise: readonly SlotRule[], p: Pick): string {
  const rules = [...praise].sort((a, b) => PRAISE_ORDER.indexOf(a.id) - PRAISE_ORDER.indexOf(b.id));
  const ids = rules.map((r) => r.id);
  const p1 = rules.find((r) => r.id === 'P1');
  const p3d = rules.find((r) => r.id === 'P3' && r.subjectId === 'fight.damage');
  const build = (form: 'full' | 'compact', pick: Pick) => {
    const joint = p1 && p3d ? carryLateText(sheet, pick, form) : null;
    const rest = joint ? rules.filter((r) => r !== p1 && r !== p3d) : rules;
    return [...(joint ? [joint] : []), ...rest.map((r) => praiseSentence(sheet, r, pick, form, ids.filter((x) => x !== r.id)))].join(' ');
  };
  const full = build('full', picker(sheet, []));
  return full.length <= LIMITS.itemChars && sentenceCount(full) <= LIMITS.itemSentences ? build('full', p) : build('compact', p);
}

/** 판단 틀 재료 칸 (Q5 B): 오브젝트 · 이니시(추정), 교전 · 로밍 KDA. 추정 값(첫 가해자)은 쓰지 않는다 */
function materialText(sheet: FactSheet, subjectId: string, p: Pick): string {
  if (subjectId === 'fight.initiate' && has(sheet, 'fight.initiate.min')) {
    const obj = has(sheet, 'fight.initiate.objective') ? ` 우리 팀이 ${p('fight.initiate.objective')}${josa(p('fight.initiate.objective'), '을', '를')} 잡은` : ' 오브젝트';
    let s = `${p('fight.initiate.min')}${obj} 싸움에서 첫 킬에 내가 참여했고, 우리 팀이 더 얻었습니다.`;
    if (Number(sheet.byId.get('fight.initiate.count')?.value ?? 0) > 1) s += ` 이긴 오브젝트 싸움 중 첫 킬에 참여한 싸움은 ${p('fight.initiate.count')}번이었습니다.`;
    return s;
  }
  if (subjectId === 'macro.roam' && has(sheet, 'macro.roam.me.kills')) {
    const opp = has(sheet, 'laning.opponent') ? p('laning.opponent') : '상대 라이너';
    const k = (who: string) => `${p(`macro.roam.${who}.kills`)}킬 ${p(`macro.roam.${who}.assists`)}어시스트 ${p(`macro.roam.${who}.deaths`)}데스`;
    return `게임 전체 다른 라인·정글 싸움에서 나는 ${k('me')}, 상대 ${opp}${josa(opp, '은', '는')} ${k('enemy')}였습니다.`;
  }
  return '';
}

function subjectMain(sheet: FactSheet, subjectId: string, good: boolean, p: Pick): string {
  switch (subjectId) {
    case 'laning.growth':
      return growthText(sheet, p);
    case 'laning.deaths':
      return deathsText(sheet, p);
    case 'laning.roam':
      return roamText(sheet, good, p);
    case 'fight.advantage':
      // Q7(2): 몫(%) 대신 두 팀 점수와 결과 (결과 말은 등급 경계 그대로)
      return pointsSentence(sheet, 'fight.advantage', p, { fightsId: 'fight.advantage.fights', inside: true, withWindow: true });
    case 'fight.damage': {
      // Q6: 방향에 맞는 구간을 고른다 (좋은 점 = 기대치보다 가장 높은 구간, 부족한 점 = 가장 낮은 구간). Q5까지는 차이 절댓값으로 골라
      // 좋은 점 칸에 기대치보다 낮은 구간을 "높았습니다"로 쓰는 일이 있었다(채점한 아리 판 0~15분 15.83% < 20%)
      const f = sheet.result.fight.subjects.find((x) => x.id === 'fight.damage')?.facts ?? {};
      const diff = (k: number) => (typeof f[`diff${k}`] === 'number' ? (f[`diff${k}`] as number) : null);
      const word = good ? '높았습니다' : '낮았습니다';
      const ks = [0, 1, 2].filter((k) => diff(k) !== null && has(sheet, `fight.damage.share${k}`) && (good ? diff(k)! > 0 : diff(k)! < 0));
      const k = ks.sort((a, b) => (good ? diff(b)! - diff(a)! : diff(a)! - diff(b)!))[0];
      if (k === undefined) return `챔피언 딜 비중이 ${p('player.roleAverage')}보다 ${word}.`;
      const when =
        k === 0
          ? `${p('fight.damage.phase0EndMin')}까지`
          : k === 1 && has(sheet, 'fight.damage.share2')
            ? `${p('fight.damage.phase1StartMin')}~${p('fight.damage.phase1EndMin')}`
            : `${p(`fight.damage.phase${k}StartMin`)} 이후`;
      return `${when} 챔피언 딜 비중이 ${p(`fight.damage.share${k}`)}%로 ${p('player.roleAverage')} ${p(`fight.damage.expected${k}`)}%보다 ${word}.`;
    }
    case 'fight.vision':
      return `오브젝트를 잡기 전 ${p('fight.vision.windowSec')}초 동안의 시야 점수가 오브젝트당 ${p('fight.vision.perObjective')}${ro(p('fight.vision.perObjective'))} ${good ? '높았습니다' : '낮았습니다'}.`;
    case 'fight.objective':
      return good
        ? `오브젝트 막타를 ${p('fight.objective.lastHits')}번 챙겼습니다.`
        : `오브젝트 막타를 거의 챙기지 못했습니다.`;
    case 'macro.advantage':
      return pointsSentence(sheet, 'macro.advantage', p, { fightsId: 'macro.advantage.fights', inside: false, withWindow: true });
    case 'macro.solo':
      return `단독 킬 ${p('macro.solo.kills')}번, 단독 데스 ${p('macro.solo.deaths')}번으로 혼자 싸운 결과가 ${good ? '좋았습니다' : '나빴습니다'}.`;
    case 'macro.side':
      return `분당 포탑 피해량이 ${p('macro.side.perMinute')}${ro(p('macro.side.perMinute'))} 사이드 압박이 ${good ? '좋았습니다' : '약했습니다'}.`;
    case 'macro.farm':
      return `중후반 분당 CS가 ${p('macro.farm.perMinute')}개로 ${good ? '많았습니다' : '적었습니다'}.`;
    case 'macro.vision':
      return `오브젝트를 잡기 전 ${p('fight.vision.windowSec')}초를 뺀 나머지 시간의 분당 시야 점수가 ${p('macro.vision.perMinute')}${ro(p('macro.vision.perMinute'))} ${good ? '높았습니다' : '낮았습니다'}.`;
    default:
      return good ? '이 부분은 잘했습니다.' : '이 부분은 아쉬웠습니다.';
  }
}

// ---------- 라인전 (Q4) ----------

/** 2-1 칸 + 골드·레벨 + 원인 1위 (Q5: 칸 이름과 골드·레벨을 한 문장으로) */
function growthText(sheet: FactSheet, p: Pick): string {
  const L = sheet.result.laning!;
  const cell = p('laning.growth.cell');
  let s: string;
  if (has(sheet, 'laning.gold.diffAbs')) {
    const g = L.cell.gold;
    const goldPart =
      g === 'EVEN'
        ? `골드 차이는 ${p('laning.gold.diffAbs')}${ro(p('laning.gold.diffAbs'))} 작았고`
        : `골드는 상대 ${p('laning.opponent')}보다 ${p('laning.gold.diffAbs')} ${g === 'AHEAD' ? '많았고' : '적었고'}`;
    const lv = L.cell.level;
    const levelPart = !has(sheet, 'laning.level.me')
      ? '레벨은 알 수 없었습니다'
      : lv === 'EVEN'
        ? '레벨은 같았습니다'
        : `레벨은 ${p('laning.level.diffAbs')} ${lv === 'AHEAD' ? '높았습니다' : '낮았습니다'}`;
    s = `${p('laning.referenceMin')} 라인전은 "${cell}"${euro(cell)} ${goldPart}, ${levelPart}.`;
  } else {
    s = `${p('laning.referenceMin')} 라인전은 "${cell}"에 해당합니다.`;
  }
  const c = L.growth.causes[0];
  if (c) {
    const q = `laning.cause.${c.id}`;
    const me = p(`${q}.me`);
    const enemy = p(`${q}.enemy`);
    const line: Record<string, string> = {
      killGold: `킬 현상금 합은 나 ${me}골드, 상대 ${enemy}골드였습니다.`,
      cs: `CS는 나 ${me}개, 상대 ${enemy}개였습니다.`,
      plates: `깬 포탑 방패는 나 ${me}개, 상대 ${enemy}개였습니다.`,
      deaths: `비교 시점 전 데스는 나 ${me}번, 상대 ${enemy}번이었습니다.`,
      outOfLane: `라인 밖 싸움 킬·어시스트는 나 ${me}번, 상대 ${enemy}번이었습니다.`,
    };
    s += ` ${line[c.id]}`;
  }
  return s;
}

const DEATH_PHRASE: Record<string, string> = {
  SOLO: '1:1로 죽었습니다',
  GANK: '상대 정글이 관여한 갱에 죽었습니다',
  ROAM: '다른 라인 상대가 합류해 죽었습니다',
  // Q5(C3) 정글
  JUNGLE_SOLO: '상대 정글에게 1:1로 죽었습니다',
};

/** 데스 수 + 대표 데스 하나 (일방적 1:1 → 갱 → 첫 데스). 다이브(추정)·그 밖 유형은 유형을 말하지 않는다. Q5: 데스 수와 대표 데스를 한 문장으로 */
function deathsText(sheet: FactSheet, p: Pick): string {
  const L = sheet.result.laning!;
  const head = `${p('laning.referenceMin')} 전 내 데스는 ${p('laning.deathsBefore.count')}번`;
  const shown = L.deaths.slice(0, 3);
  let i = shown.findIndex((d) => d.type === 'SOLO' && d.oneSided === true);
  if (i < 0) i = shown.findIndex((d) => d.type === 'GANK');
  if (i < 0) i = 0;
  const d = shown[i];
  if (!d) return `${head}이었습니다.`;
  const k = `laning.deathsBefore.${i}`;
  const where = has(sheet, `${k}.region`) ? ` ${p(`${k}.region`)}에서` : '';
  // Q5(C3) 정글 수적 열세: 관여한 상대 수를 쓴다
  const phrase = d.type === 'OUTNUMBERED' ? `상대 ${p(`${k}.enemies`)}명이 관여한 수적 열세 싸움에서 죽었습니다` : (DEATH_PHRASE[d.type] ?? '죽었습니다');
  let s = `${head}이었고, ${p(`${k}.min`)}에${where} ${phrase}.`;
  if ((d.type === 'SOLO' || d.type === 'JUNGLE_SOLO') && has(sheet, `${k}.dealt`)) {
    const received = p(`${k}.received`);
    s += ` 죽기 직전 내가 준 피해는 ${p(`${k}.dealt`)}, 받은 피해는 ${received}${ro(received)} ${d.oneSided ? '일방적으로 당했습니다' : '교환 끝에 졌습니다'}.`;
  }
  else if (d.type === 'GANK' && has(sheet, `${k}.wardsBefore`)) s += ` 그 전 ${p('laning.deathsBefore.wardWindowSec')}초 동안 내가 설치한 와드는 ${p(`${k}.wardsBefore`)}개였습니다.`;
  return s;
}

/** "1킬 1어시스트" (0인 쪽은 뺀다) */
function kaText(sheet: FactSheet, who: 'me' | 'enemy', p: Pick): string {
  const q = `laning.involve.${who}`;
  const k = Number(sheet.byId.get(`${q}.kills`)?.value ?? 0);
  const a = Number(sheet.byId.get(`${q}.assists`)?.value ?? 0);
  const parts = [...(k > 0 ? [`${p(`${q}.kills`)}킬`] : []), ...(a > 0 ? [`${p(`${q}.assists`)}어시스트`] : [])];
  return parts.length > 0 ? `(${parts.join(' ')})` : '';
}

/**
 * 한쪽의 킬 관여가 어디서 났나 (주어 + 서술). 맞상대를 잡음(VS_LANER) / 다른 라인·정글 싸움(OUT_OF_LANE) / 그 밖 라인 안(IN_LANE).
 * 예: "다이애나의 1킬은 3:21 미드 라인 우리 포탑 쪽에서 나를 잡은 것", "내 2번은 모두 4:22 상대 정글 위쪽(탑 쪽) 등 다른 라인·정글 싸움"
 */
function involvementWhere(sheet: FactSheet, who: 'me' | 'enemy', p: Pick): string | null {
  const q = `laning.involve.${who}`;
  const total = Number(sheet.byId.get(`${q}.count`)?.value ?? 0);
  if (total === 0) return null;
  const opp = p('laning.opponent');
  const vs = Number(sheet.byId.get(`${q}.vsLaner`)?.value ?? 0);
  const out = Number(sheet.byId.get(`laning.roam.${who}`)?.value ?? 0);
  const inLane = total - vs - out;
  const subject = who === 'me' ? '내' : `${opp}의`;
  // 한 번뿐이면 "1킬"·"1어시스트", 여러 번이면 "N번"
  const kills = Number(sheet.byId.get(`${q}.kills`)?.value ?? 0);
  const count = total === 1 ? (kills === 1 ? `${p(`${q}.kills`)}킬` : `${p(`${q}.assists`)}어시스트`) : `${p(`${q}.count`)}번`;
  const victim = who === 'me' ? `${opp}${josa(opp, '을', '를')}` : '나를';
  const vsPlace = () => {
    const where = has(sheet, `${q}.vsLaner.0.region`) ? ` ${p(`${q}.vsLaner.0.region`)}에서` : '';
    return `${p(`${q}.vsLaner.0.min`)}${where}`;
  };
  const outPlace = () => {
    const where = has(sheet, `laning.roam.${who}.0.region`) ? ` ${p(`laning.roam.${who}.0.region`)}` : '';
    return `${p(`laning.roam.${who}.0.min`)}${where}`;
  };
  if (vs === total) return `${subject} ${count}${total === 1 ? josa(count, '은', '는') : '은 모두'} ${vsPlace()} ${victim} 잡은 것`;
  if (out === total) return `${subject} ${count}${total === 1 ? josa(count, '은', '는') : '은 모두'} ${outPlace()}${total === 1 ? '의' : ' 등'} 다른 라인·정글 싸움`;
  const parts = [
    ...(vs > 0 ? [`${victim} 잡은 것이 ${p(`${q}.vsLaner`)}번`] : []),
    ...(out > 0 ? [`다른 라인·정글 싸움이 ${p(`laning.roam.${who}`)}번`] : []),
    ...(inLane > 0 && has(sheet, `${q}.inLane`) ? [`라인에서 다른 상대를 잡은 것이 ${p(`${q}.inLane`)}번`] : []),
  ];
  return `${subject} ${p(`${q}.count`)}번 중 ${parts.join(', ')}`;
}

/**
 * Q7(사용자 채점 2026-11-24 "1인데 왜 0?"): 라인 밖 칸 = 라인전 전체 킬 관여(킬+어시스트, 나·상대) 먼저 → 그 킬이 어디서 났나
 * (상대의 킬 관여 → 내 킬 관여 순). 예: "15:00까지 킬 관여는 나 2번(1킬 1어시스트), 다이애나 1번(1킬)이었습니다.
 * 다이애나의 1킬은 3:21 미드 라인 우리 포탑 쪽에서 나를 잡은 것이고, 내 2번은 모두 4:22 상대 정글 위쪽(탑 쪽) 등 다른 라인·정글 싸움이었습니다."
 * 부족한 점 칸은 길이가 허락하면 상대가 라인을 비운 사이 깬 방패를 덧붙인다. 라인 밖 판정(2-2)·R9는 그대로.
 */
function roamText(sheet: FactSheet, good: boolean, p: Pick): string {
  if (!has(sheet, 'laning.roam.me')) return good ? '이 부분은 잘했습니다.' : '이 부분은 아쉬웠습니다.';
  const opp = p('laning.opponent');
  if (!has(sheet, 'laning.involve.me.count')) {
    return `${p('laning.referenceMin')}까지 다른 라인·정글 싸움 킬·어시스트는 나 ${p('laning.roam.me')}번, 상대 ${opp} ${p('laning.roam.enemy')}번이었습니다.`;
  }
  let s = `${p('laning.referenceMin')}까지 킬 관여는 나 ${p('laning.involve.me.count')}번${kaText(sheet, 'me', p)}, ${opp} ${p('laning.involve.enemy.count')}번${kaText(sheet, 'enemy', p)}이었습니다.`;
  const clauses = [involvementWhere(sheet, 'enemy', p), involvementWhere(sheet, 'me', p)].filter((x): x is string => x !== null);
  if (clauses.length > 0) {
    const end = (x: string, last: boolean) => `${x}${last ? josa(x, '이었습니다', '였습니다') : josa(x, '이고', '고')}`;
    s += ` ${clauses.map((x, i) => end(x, i === clauses.length - 1)).join(', ')}.`;
  }
  if (!good && has(sheet, 'laning.roam.platesWhileAway.0.min')) {
    const extra = ` 상대가 라인을 비운 ${p('laning.roam.platesWhileAway.0.min')}에 나는 방패를 깼습니다.`;
    if (s.length + extra.length <= LIMITS.itemChars) s += extra;
  }
  return s;
}

/** 요약의 라인전 말 (Q4: 2-1 칸마다) */
const LANING_CELL_MID: Record<string, string> = {
  LEAD: '우위였고',
  GOLD_LEAD: '골드로 앞섰고',
  LEVEL_LEAD: '골드는 비슷했지만 레벨로 앞섰고',
  GAP_COVERED: '레벨은 뒤졌지만 골드로 성장 격차를 잘 따라갔고',
  BASICS_KEPT: '골드는 뒤졌지만 레벨로 기본기는 잘 따라갔고',
  EVEN: '비슷했고',
  LEVEL_BEHIND: '골드는 비슷했지만 레벨이 뒤졌고',
  XP_KEPT_GOLD_LOST: '경험치는 따라갔지만 골드를 내줬고',
  LOST: '골드와 레벨 모두 밀렸고',
};
const midToEnd = (mid: string): string => mid.replace(/였고$/, '였습니다').replace(/했고$/, '했습니다').replace(/섰고$/, '섰습니다').replace(/졌고$/, '졌습니다').replace(/갔고$/, '갔습니다').replace(/줬고$/, '줬습니다').replace(/렸고$/, '렸습니다');

const VERDICT_MID: Record<string, string> = { 우세: '우세였고', 열세: '열세였고', 비슷: '비슷했고', 잘함: '잘했고', 보통: '보통이었고', 부족: '부족했고' };
const VERDICT_END: Record<string, string> = { 우세: '우세였습니다', 열세: '열세였습니다', 비슷: '비슷했습니다', 잘함: '잘했습니다', 보통: '보통이었습니다', 부족: '부족했습니다' };

function keyMomentText(sheet: FactSheet, index: number, p: Pick, withFollowUp: boolean): string {
  const km = sheet.result.keyMoments[index]!;
  const k = `keyMoment.${index}`;
  let s: string;
  if (isReversed(km.goldDiffBefore, km.goldDiffAfter)) {
    // 역전: 격차 변화(|뒤|−|앞|) 대신 앞선 팀이 바뀐 것과 우리 팀 기준 손익을 쓴다 (Q1)
    const side = km.swing > 0 ? '이득을' : '손해를';
    s = `${p(`${k}.startMin`)}에 킬 ${p(`${k}.kills`)}개가 난 싸움 뒤 골드가 앞선 팀이 ${p(`${k}.leaderBefore`)}에서 ${p(`${k}.leaderAfter`)}으로 바뀌었고, 우리 팀이 골드 ${p(`${k}.swingAbs`)} ${side} 봤습니다.`;
  } else {
    const dir = km.direction === 'widened' ? '벌어졌습니다' : '좁혀졌습니다';
    s = `${p(`${k}.startMin`)}에 킬 ${p(`${k}.kills`)}개가 난 싸움 뒤 골드 격차가 ${p(`${k}.gapChangeAbs`)} ${dir}.`;
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
  const cell = sheet.result.laning?.cell.id;
  const phrase = (n: string, x: string, last: boolean) => {
    if (n === '라인전은' && cell) return last ? midToEnd(LANING_CELL_MID[cell]!) : LANING_CELL_MID[cell]!;
    return last ? VERDICT_END[x] : VERDICT_MID[x];
  };
  let first = known.map(([n, x], i) => `${n} ${phrase(n, x, i === known.length - 1)}`).join(', ');
  if (known.length === 0) first = '이 판은 영역별 판정을 내릴 수 없었습니다';
  let s = `${first}.`;
  if (v.keyMomentIndex !== null && sheet.result.keyMoments[v.keyMomentIndex]) {
    s += ` ${keyMomentText(sheet, v.keyMomentIndex, p, false)}`;
  }
  return s;
}

/** 후보 문장 중 칸 길이(170자·3문장) 안에 드는 첫 꼴 (없으면 마지막). 고른 뒤에만 실제 picker로 fact를 기록한다 */
function firstFit(sheet: FactSheet, cands: readonly ((q: Pick) => string)[], p: Pick): string {
  const fits = (t: string) => t.length <= LIMITS.itemChars && sentenceCount(t) <= LIMITS.itemSentences;
  const pick = cands.find((c) => fits(c(picker(sheet, [])))) ?? cands[cands.length - 1]!;
  return pick(p);
}

/** 칸 하나의 템플릿 문장 */
export function templateFor(sheet: FactSheet, slot: Slot): SlotText {
  const used: string[] = [];
  const p = picker(sheet, used);
  let text: string;
  if (slot.area === 'summary') text = summaryText(sheet, p);
  else if (slot.area === 'keyMoment') text = keyMomentText(sheet, slot.index!, p, true);
  else if (slot.origin === 'material') text = materialText(sheet, slot.subjectId!, p);
  else if (slot.origin === 'rule') {
    const primary = slot.rules.filter((r) => !r.merged);
    // Q6: 칭찬 규칙으로 채운 칸은 칭찬 문장 (같은 칸의 칭찬끼리 읽는 순서로)
    const praise = primary.filter((r) => isPraise(r.id));
    text = [...(praise.length > 0 ? [praiseText(sheet, praise, p)] : []), ...primary.filter((r) => !isPraise(r.id)).map((r) => ruleSentence(sheet, r, p))].join(' ');
  } else if (slot.rules.some((r) => isPraise(r.id) && !r.merged)) {
    // Q6: 칭찬 규칙이 붙은 등급 과목 칸 → 과목 문장 대신 칭찬 문장. 득실 칸의 R4(예: 이득 교환)는 칸 길이 안이면 뒤에 붙인다
    // Q7: P4 칸은 [기여 둘 다 + R4] → [한 문장 꼴(높았던 기여, 없으면 관여) + R4] → [점수만 + R4](높았던 기여가 없을 때) → [기여 둘 다] → [한 문장 꼴]
    //     순으로 길이 안에 드는 첫 꼴 (R4 장면 시각·이득 교환(Q2·Q5)을 지키고, 기여는 줄여서라도 함께 쓴다)
    const praise = slot.rules.filter((r) => isPraise(r.id) && !r.merged);
    const r4 = slot.subjectId === 'fight.advantage' ? slot.rules.find((r) => r.id === 'R4' && !r.merged) : undefined;
    const p4 = praise.find((r) => r.id === 'P4');
    const others = praise.filter((r) => r !== p4);
    const withP4 = (q: Pick, form: 'full' | 'compact' | 'bare') => [...(others.length > 0 ? [praiseText(sheet, others, q)] : []), ...(p4 ? [p4Sentence(sheet, p4, q, form)] : [])].join(' ');
    const cands: ((q: Pick) => string)[] = p4
      ? [
          ...(r4 ? [(q: Pick) => `${withP4(q, 'full')} ${ruleSentence(sheet, r4, q)}`, (q: Pick) => `${withP4(q, 'compact')} ${ruleSentence(sheet, r4, q)}`] : []),
          ...(r4 && !p4.required.some((id) => /\.(involvementPct|killedDamagePct)$/.test(id)) ? [(q: Pick) => `${withP4(q, 'bare')} ${ruleSentence(sheet, r4, q)}`] : []),
          (q: Pick) => withP4(q, 'full'),
          (q: Pick) => withP4(q, 'compact'),
        ]
      : [...(r4 ? [(q: Pick) => `${praiseText(sheet, praise, q)} ${ruleSentence(sheet, r4, q)}`] : []), (q: Pick) => praiseText(sheet, praise, q)];
    text = firstFit(sheet, cands, p);
  } else {
    // Q5(A4): 오브젝트 싸움 득실 칸에 R4(내 역할 해석, 예: 이득 교환)가 있으면 장면 문장 대신 R4 문장 (길이 한도 안일 때)
    // Q7: 득실 부족한 점 칸에 R12(내 기여 낮음)가 있으면 과목 문장(두 팀 점수) 뒤에 낮았던 기여를 먼저 붙인다
    const main = (q: Pick) => subjectMain(sheet, slot.subjectId!, slot.kind === 'good', q);
    const r4 = slot.subjectId === 'fight.advantage' ? slot.rules.find((r) => r.id === 'R4' && !r.merged) : undefined;
    const r12 = slot.subjectId === 'fight.advantage' ? slot.rules.find((r) => r.id === 'R12' && !r.merged) : undefined;
    const low = (q: Pick) => (r12 ? ` 그 싸움들에서 ${joinClauses(contributionClauses(sheet, r12, q, 'short'))}` : '');
    const cands: ((q: Pick) => string)[] = [
      ...(r4 ? [(q: Pick) => `${main(q)}${low(q)} ${ruleSentence(sheet, r4, q)}`] : []),
      ...(r12 ? [(q: Pick) => `${main(q)}${low(q)}`] : []),
      (q: Pick) => subjectText(sheet, slot.subjectId!, slot.kind === 'good', q),
    ];
    text = firstFit(sheet, cands, p);
  }
  // Q5 B: 합친 규칙은 사실 한 문장씩 (조언 없음)
  for (const r of slot.rules.filter((x) => x.merged)) text += ` ${ruleSentence(sheet, r, p, true)}`;
  return { text, factIds: used };
}
