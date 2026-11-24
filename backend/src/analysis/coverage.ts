// Q5 B (ai_spec Q5): 사용자 판단 틀 항목이 칸 수 때문에 문장에서 빠지지 않게, 말할 칸(영역마다 좋은 점·부족한 점 각 최대 2개)을 정한다.
// 순서: ① 엔진 말할 순서(등급 과목, Q4까지와 같음)로 앞 2칸 → ② 발동했지만 칸이 없는 규칙(R1~R11)과 판단 틀 재료
// (이니시 추정·라인 밖 KDA)로 빈 칸을 채움 → ③ 그래도 남은 규칙은 같은 영역의 관련 칸에 "합칠 후보"로 넘긴다.
// 합칠지(길이 한도)는 문장 단계(llm/facts.ts)가 템플릿 길이로 정한다. 판정(등급·점수·말할 순서)은 바꾸지 않는다.
// 입력은 엔진 결과만이라 RAG 검색(rag/retrieve.ts)도 같은 칸을 쓴다.
// Q6: 칭찬 규칙(P1~P4)도 같은 길(빈 칸 채우기 → 합치기)을 탄다. 좋은 점 칸은 칭찬 근거가 가장 강한 칸을 먼저 둔다.
import { rulesFor } from './advice.js';
import { isPraise, PRAISE_STRENGTH } from './praise.js';
import type { AnalysisResult, FightScene, FiredRule } from './types.js';

export type ItemArea = 'laning' | 'fight' | 'macro';
export type ItemKind = 'good' | 'bad';

/** 영역마다 좋은 점·부족한 점 각각 최대 몇 개 (api_contract 2-7) */
export const MAX_ITEMS_PER_KIND = 2;

/** 사용자 판단 틀 항목 (2026-11-19 판단 틀, ai_spec Q4 1~4장). existing = 기존 과목(반영 비율·득실·첫 데스·단독 킬 등) */
export type FrameworkKey =
  | 'laning.growth'
  | 'laning.deaths'
  | 'laning.roam'
  | 'fight.damage'
  | 'fight.initiate'
  | 'fight.survive'
  | 'fight.vision'
  | 'macro.gold'
  | 'macro.roam'
  // Q6 칭찬 규칙
  | 'praise.carry'
  | 'praise.solo'
  | 'praise.late'
  | 'praise.objective'
  | 'existing';

/** 판단 틀 이름 (채점표 "판단 틀" 줄·0원 표) */
export const FRAMEWORK_LABEL: Readonly<Record<Exclude<FrameworkKey, 'existing'>, string>> = {
  'laning.growth': '라인전 · 내 성장(골드×레벨)',
  'laning.deaths': '라인전 · 데스',
  'laning.roam': '라인전 · 팀 성장(라인 밖)',
  'fight.damage': '오브젝트 · 딜량',
  'fight.initiate': '오브젝트 · 이니시(추정)',
  'fight.survive': '오브젝트 · 버티기',
  'fight.vision': '오브젝트 · 시야',
  'macro.gold': '교전 · 골드 격차',
  'macro.roam': '교전 · 로밍 KDA',
  'praise.carry': '칭찬 · 딜 캐리(P1)',
  'praise.solo': '칭찬 · 1:1 킬(P2)',
  'praise.late': '칭찬 · 후반 영향력(P3)',
  'praise.objective': '칭찬 · 오브젝트 싸움 기여(P4)',
};

/** 판단 틀 항목의 영역 (교전 = 그 밖의 운영 영역에서 말한다) */
export const FRAMEWORK_AREA: Readonly<Record<Exclude<FrameworkKey, 'existing'>, ItemArea>> = {
  'laning.growth': 'laning',
  'laning.deaths': 'laning',
  'laning.roam': 'laning',
  'fight.damage': 'fight',
  'fight.initiate': 'fight',
  'fight.survive': 'fight',
  'fight.vision': 'fight',
  'macro.gold': 'macro',
  'macro.roam': 'macro',
  'praise.carry': 'fight',
  'praise.solo': 'macro',
  // P3은 교전 딜 칸·운영 단독 킬·데스 칸 둘 다에 붙는다 (라인전 비교 불가 판에서도 말할 수 있다는 뜻으로 교전)
  'praise.late': 'fight',
  'praise.objective': 'fight',
};

/**
 * 우선순위 (작을수록 먼저, 영역 안에서만 비교). 사용자 판단 틀 순서:
 * 라인전 = 내 성장(R8) → 데스(R6·R7) → 팀 성장(R9) / 오브젝트 = 버티기(R10) → 시야(R11) → 이니시(추정) → 딜량 /
 * 교전·운영 = 골드 격차 → 로밍 KDA. 기존 과목 규칙(R1~R5)은 그 뒤.
 * Q6 칭찬 규칙은 좋은 점 칸에서 "가장 강한 근거 먼저"라 판단 틀보다 앞(음수): 딜 캐리 → 후반 영향력 → 1:1 킬 → 오브젝트 싸움 기여.
 * (칭찬은 좋은 점에만, 판단 틀 규칙 R6~R11은 부족한 점에만 붙어 같은 칸을 두고 다투지 않는다. 좋은 점 재료·R4와만 순서가 갈린다)
 */
export const FRAMEWORK_PRIORITY: Readonly<Record<FrameworkKey, number>> = {
  'praise.carry': -4,
  'praise.late': -3,
  'praise.solo': -2,
  'praise.objective': -1,
  'laning.growth': 1,
  'laning.deaths': 2,
  'laning.roam': 3,
  'fight.survive': 1,
  'fight.vision': 2,
  'fight.initiate': 3,
  'fight.damage': 4,
  'macro.gold': 1,
  'macro.roam': 2,
  existing: 9,
};

/** 규칙 → 판단 틀 항목 (발동 규칙 FiredRule·칸 규칙 모두 id·subjectId만 본다) */
export function ruleFramework(r: Pick<FiredRule, 'id' | 'subjectId'>): FrameworkKey {
  switch (r.id) {
    case 'R6':
    case 'R7':
      return 'laning.deaths';
    case 'R8':
      return 'laning.growth';
    case 'R9':
      return 'laning.roam';
    case 'R10':
      return 'fight.survive';
    case 'R11':
      return 'fight.vision';
    // Q7: 오브젝트 싸움 내 기여(잡은 상대가 받은 피해 중 내 몫·킬 관여)는 "오브젝트 · 딜량"의 확정 값 근거 (1분 단위 추정 딜을 대신함)
    case 'R12':
      return 'fight.damage';
    case 'P1':
      return 'praise.carry';
    case 'P2':
      return 'praise.solo';
    case 'P3':
      return 'praise.late';
    case 'P4':
      return 'praise.objective';
    case 'R1':
    case 'R2':
    case 'R3':
      return r.subjectId === 'fight.vision' ? 'fight.vision' : r.subjectId === 'fight.damage' ? 'fight.damage' : 'existing';
    default:
      return 'existing';
  }
}

/** 과목 → 판단 틀 항목 (등급 과목·새 항목 모두) */
export function subjectFramework(subjectId: string): FrameworkKey {
  switch (subjectId) {
    case 'laning.growth':
    case 'laning.deaths':
    case 'laning.roam':
    case 'fight.damage':
    case 'fight.vision':
    case 'fight.initiate':
    case 'macro.roam':
      return subjectId;
    default:
      return 'existing';
  }
}

/** 판단 틀 이름. 기존 과목은 "기존 과목 · (과목 이름)" */
export function frameworkLabel(key: FrameworkKey, subjectName: string): string {
  return key === 'existing' ? `기존 과목 · ${subjectName}` : FRAMEWORK_LABEL[key];
}

/**
 * 칸 하나의 판단 틀 이름들 (채점표 "판단 틀" 줄). 등급 과목 칸은 과목의 판단 틀 먼저, 규칙으로 채운 칸은 규칙의 판단 틀만.
 * 합친 규칙은 "(합침)"을 붙인다. subjectName = 과목 ID → 한국어 이름.
 */
export function frameworkLabelsOf(
  item: { subjectId: string; origin: PlannedItem['origin']; rules: readonly { id: FiredRule['id']; subjectId: string; merged?: true }[] },
  subjectName: (id: string) => string,
): string[] {
  const out: string[] = [];
  const add = (x: string) => {
    if (!out.includes(x)) out.push(x);
  };
  if (item.origin !== 'rule') add(frameworkLabel(subjectFramework(item.subjectId), subjectName(item.subjectId)));
  for (const r of item.rules.filter((x) => !x.merged)) add(frameworkLabel(ruleFramework(r), subjectName(r.subjectId)));
  for (const r of item.rules.filter((x) => x.merged)) add(`${frameworkLabel(ruleFramework(r), subjectName(r.subjectId))} (합침)`);
  return out;
}

/** 과목 ID의 영역 */
export const areaOf = (subjectId: string): ItemArea => subjectId.split('.')[0] as ItemArea;

/**
 * 같은 규칙을 한 번만 세는 열쇠. R10은 딜·득실 두 과목에 같은 근거로 붙으므로 과목을 빼고 센다.
 * R4는 좋은 점·부족한 점에 따로 붙는다.
 */
export const ruleKey = (r: FiredRule): string => (r.id === 'R10' ? `R10:${r.kind}` : `${r.id}:${r.kind}:${r.subjectId}`);

/** 새 칸을 만들 때 쓰는 과목: R10은 오브젝트 싸움 득실 칸(같은 싸움의 R4와 함께), 그 밖은 규칙이 붙은 과목 */
const itemSubjectOf = (r: FiredRule): string => (r.id === 'R10' ? 'fight.advantage' : r.subjectId);

/** 합칠 칸 고르는 순서 (같은 영역·같은 방향 안). 없으면 그 영역의 다른 칸 순서대로 */
const MERGE_TARGETS: Readonly<Record<FrameworkKey, readonly string[]>> = {
  'laning.growth': ['laning.deaths', 'laning.roam'],
  'laning.deaths': ['laning.growth', 'laning.roam'],
  'laning.roam': ['laning.deaths', 'laning.growth'],
  'fight.survive': ['fight.advantage', 'fight.damage'],
  'fight.vision': ['fight.advantage', 'fight.objective'],
  'fight.damage': ['fight.advantage'],
  'fight.initiate': [],
  'macro.gold': [],
  'macro.roam': [],
  // Q6 칭찬: 같은 근거를 말하는 칸 먼저 (P3은 교전·운영 두 영역의 칸)
  'praise.carry': ['fight.damage', 'fight.advantage'],
  'praise.solo': ['macro.solo', 'macro.advantage'],
  'praise.late': ['fight.damage', 'macro.solo', 'fight.advantage', 'macro.advantage'],
  'praise.objective': ['fight.advantage', 'fight.damage'],
  existing: ['fight.advantage', 'fight.initiate', 'macro.advantage', 'macro.solo'],
};

/**
 * R4(내 역할 해석)가 그 방향의 칸 하나를 혼자 채울 수 있나: 좋은 점 = 이득 교환·살아남음·탱커가 먼저 죽고 이김(싸움을 연 것으로 보임),
 * 부족한 점 = 먼저 죽음·나도 죽음. 그 밖(이긴 싸움에서 나도 죽음·딜러가 먼저 잡힘, 진 싸움에서 살아남음)은 좋은/부족한 점으로 읽히지 않아
 * 새 칸을 만들지 않고 있는 칸에 합칠 때만 쓴다.
 */
export function r4StandsAlone(r: FiredRule): boolean {
  if (r.id !== 'R4') return true;
  const status = r.facts.status;
  if (r.kind === 'good') return status === 'TRADE' || status === 'SURVIVED' || (status === 'FIRST' && r.facts.tank === true);
  return status === 'FIRST' || status === 'DIED';
}

export interface PlannedItem {
  area: ItemArea;
  kind: ItemKind;
  subjectId: string;
  /** graded = 엔진 말할 순서(등급 과목) · rule = 발동한 규칙으로 빈 칸을 채움 · material = 판단 틀 재료(이니시 추정·라인 밖 KDA)로 빈 칸을 채움 */
  origin: 'graded' | 'rule' | 'material';
  /** 이 칸의 규칙 (graded는 rulesFor 그대로, rule은 채운 규칙들) */
  rules: FiredRule[];
}

/** 칸이 다 차서 같은 영역의 칸에 합칠 규칙 하나 */
export interface MergeCandidate {
  area: ItemArea;
  kind: ItemKind;
  rule: FiredRule;
  framework: FrameworkKey;
  priority: number;
  /** 합칠 칸의 과목 (앞이 먼저, 같은 영역·방향 칸만) */
  targets: string[];
  /** 왜 합치나: full = 그 방향 칸이 다 참 · extra = 규칙으로 채운 칸의 둘째 규칙 · not_standalone = 혼자 칸을 만들지 않는 R4 해석 */
  why: 'full' | 'extra' | 'not_standalone';
}

/** 판단 틀 재료(이니시 추정·라인 밖 KDA)의 처리 결과 */
export interface MaterialNote {
  framework: 'fight.initiate' | 'macro.roam';
  kind: ItemKind | null;
  /** item = 빈 칸을 채움 · no_slot = 빈 칸이 없어 말하지 않음(재료는 합치지 않는다) · none = 재료 없음 */
  status: 'item' | 'no_slot' | 'none';
  reason: string;
}

export interface ItemPlan {
  items: PlannedItem[];
  merges: MergeCandidate[];
  materials: MaterialNote[];
  /** 말할 순서에 있었지만 칸 수 때문에 빠진 등급 과목 중 규칙이 없는 것 (Q4까지와 같음) */
  overflow: { area: ItemArea; kind: ItemKind; subjectId: string }[];
}

// ---------- 판단 틀 재료 ----------

/**
 * 오브젝트 · 이니시(추정) 재료: 내가 참여한 오브젝트 싸움 중 우리 팀이 이긴 싸움에서 그 싸움 첫 킬에 내가 킬·어시스트로 참여한 것(확정 사실).
 * 첫 데스에게 처음 피해를 준 사람이 나인 싸움(추정)을 먼저, 그다음 득실 차가 큰 싸움, 이른 싸움.
 */
export function initiateFight(result: Pick<AnalysisResult, 'scenes'>): { fight: FightScene; count: number } | null {
  const won = (result.scenes?.objectiveFights ?? []).filter((f) => f.inFirstKill && f.pointsOurs > f.pointsTheirs);
  if (won.length === 0) return null;
  const net = (f: FightScene) => f.pointsOurs - f.pointsTheirs;
  const fight = [...won].sort((a, b) => Number(b.firstHitByMe === true) - Number(a.firstHitByMe === true) || net(b) - net(a) || a.startSec - b.startSec)[0]!;
  return { fight, count: won.length };
}

/** 교전 · 로밍 KDA 방향: 게임 전체 라인 밖 (킬 + 어시스트 − 데스)가 상대 라이너보다 크면 좋은 점, 작으면 부족한 점, 같거나 없으면 null */
export function roamKdaKind(result: Pick<AnalysisResult, 'scenes'>): ItemKind | null {
  const k = result.scenes?.roamKda;
  if (!k) return null;
  const net = (x: { kills: number; assists: number; deaths: number }) => x.kills + x.assists - x.deaths;
  const d = net(k.me) - net(k.enemy);
  return d > 0 ? 'good' : d < 0 ? 'bad' : null;
}

// ---------- 칸 정하기 ----------

/** 칸의 칭찬 세기 (그 칸에 처음부터 붙은 칭찬 규칙만, P1 4 · P3 3 · P2 2 · P4 1의 합) */
export const praiseStrengthOf = (rules: readonly Pick<FiredRule, 'id'>[]): number => rules.filter((r) => isPraise(r.id)).reduce((s, r) => s + (PRAISE_STRENGTH[r.id] ?? 0), 0);

/** Q6 "좋은 점 칸에는 그 영역에서 가장 강한 근거를 먼저": 칭찬 세기 큰 칸 먼저, 같으면 원래 순서 */
function sortByPraise(items: PlannedItem[]): PlannedItem[] {
  return items
    .map((it, i) => ({ it, i, w: praiseStrengthOf(it.rules) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.it);
}

interface Candidate {
  kind: ItemKind;
  subjectId: string;
  priority: number;
  origin: 'rule' | 'material';
  rules: FiredRule[];
  order: number;
}

export function planItems(result: AnalysisResult): ItemPlan {
  const items: PlannedItem[] = [];
  const merges: MergeCandidate[] = [];
  const materials: MaterialNote[] = [];
  const overflow: ItemPlan['overflow'] = [];
  const allRules = result.advice?.rules ?? [];

  for (const area of ['laning', 'fight', 'macro'] as const) {
    if (area === 'laning' && result.laning === null) continue;
    const byKind: Record<ItemKind, PlannedItem[]> = { good: [], bad: [] };
    // ① 등급 과목 (엔진 말할 순서 앞 2개)
    for (const kind of ['good', 'bad'] as const) {
      const order = result.speakOrder[area][kind];
      order.slice(0, MAX_ITEMS_PER_KIND).forEach((subjectId) => byKind[kind].push({ area, kind, subjectId, origin: 'graded', rules: rulesFor(result.advice, subjectId, kind) }));
      for (const subjectId of order.slice(MAX_ITEMS_PER_KIND)) {
        if (rulesFor(result.advice, subjectId, kind).length === 0) overflow.push({ area, kind, subjectId });
      }
    }
    const spoken = new Set<string>();
    for (const it of [...byKind.good, ...byKind.bad]) for (const r of it.rules) spoken.add(ruleKey(r));

    // ② 칸이 없는 규칙 → 새 칸 후보 (같은 방향·같은 과목끼리 묶음). R10은 두 과목 중 득실 칸 쪽 하나만
    const groups = new Map<string, Candidate>();
    const mergeOnly: FiredRule[] = [];
    allRules.forEach((r, i) => {
      if (areaOf(r.subjectId) !== area || spoken.has(ruleKey(r))) return;
      if (r.id === 'R10' && r.subjectId !== 'fight.advantage' && allRules.some((x) => x.id === 'R10' && x.kind === r.kind && x.subjectId === 'fight.advantage')) return;
      if (!r4StandsAlone(r)) {
        mergeOnly.push(r);
        return;
      }
      const subjectId = itemSubjectOf(r);
      const key = `${r.kind}:${subjectId}`;
      const g = groups.get(key) ?? { kind: r.kind, subjectId, priority: Infinity, origin: 'rule' as const, rules: [], order: i };
      g.rules.push(r);
      g.priority = Math.min(g.priority, FRAMEWORK_PRIORITY[ruleFramework(r)]);
      groups.set(key, g);
    });
    const cands: Candidate[] = [...groups.values()];
    // 판단 틀 재료 (빈 칸이 있을 때만 말한다)
    if (area === 'fight') {
      const ini = initiateFight(result);
      if (ini) cands.push({ kind: 'good', subjectId: 'fight.initiate', priority: FRAMEWORK_PRIORITY['fight.initiate'], origin: 'material', rules: [], order: 1000 });
      else materials.push({ framework: 'fight.initiate', kind: null, status: 'none', reason: '이긴 오브젝트 싸움에서 첫 킬에 참여한 적 없음' });
    }
    if (area === 'macro') {
      const k = roamKdaKind(result);
      if (k) cands.push({ kind: k, subjectId: 'macro.roam', priority: FRAMEWORK_PRIORITY['macro.roam'], origin: 'material', rules: [], order: 1001 });
      else materials.push({ framework: 'macro.roam', kind: null, status: 'none', reason: result.scenes?.roamKda ? '나와 상대 라이너가 같음' : '정글이거나 상대 라이너 없음' });
    }
    cands.sort((a, b) => a.priority - b.priority || a.order - b.order);
    // 합칠 후보는 칸이 모두 정해진 뒤에 만든다 (prefer = 먼저 시도할 칸의 과목)
    const deferred: { rule: FiredRule; prefer: string | null; why: MergeCandidate['why'] }[] = [];
    for (const c of cands) {
      const list = byKind[c.kind];
      if (list.length < MAX_ITEMS_PER_KIND) {
        // 규칙으로 채운 칸은 우선순위가 가장 높은 규칙 하나로 만들고(예: 버티기 R10), 같은 칸의 나머지 규칙(예: 기존 R4)은
        // 그 칸에 먼저 합쳐 본다 → 길이 한도(facts.ts MERGE_LIMIT)를 넘으면 빠진다
        const rules = [...c.rules].sort((a, b) => FRAMEWORK_PRIORITY[ruleFramework(a)] - FRAMEWORK_PRIORITY[ruleFramework(b)]);
        list.push({ area, kind: c.kind, subjectId: c.subjectId, origin: c.origin, rules: rules.slice(0, 1) });
        for (const r of rules.slice(1)) deferred.push({ rule: r, prefer: c.subjectId, why: 'extra' });
        for (const r of c.rules) spoken.add(ruleKey(r));
        if (c.origin === 'material') materials.push({ framework: c.subjectId as MaterialNote['framework'], kind: c.kind, status: 'item', reason: '빈 칸을 채움' });
        continue;
      }
      if (c.origin === 'material') {
        materials.push({ framework: c.subjectId as MaterialNote['framework'], kind: c.kind, status: 'no_slot', reason: `${c.kind === 'good' ? '좋은 점' : '부족한 점'} 칸이 다 참 (재료는 합치지 않음)` });
        continue;
      }
      // ③ 칸이 다 참 → 같은 영역·방향의 관련 칸에 합칠 후보 (규칙마다)
      for (const r of c.rules) deferred.push({ rule: r, prefer: null, why: 'full' });
    }
    // 혼자 칸을 채우지 않는 R4는 있는 칸에 합칠 때만
    for (const r of mergeOnly) deferred.push({ rule: r, prefer: null, why: 'not_standalone' });
    // Q6: 좋은 점 칸은 칭찬 근거가 가장 강한 칸을 먼저 (안정 정렬: 칭찬이 없는 칸끼리는 Q5까지의 순서 그대로)
    byKind.good = sortByPraise(byKind.good);
    for (const { rule: r, prefer, why } of deferred) {
      const fw = ruleFramework(r);
      const present = byKind[r.kind].map((x) => x.subjectId);
      const pref = [...(prefer ? [prefer] : []), ...MERGE_TARGETS[fw].filter((x) => x !== prefer)].filter((x) => present.includes(x));
      merges.push({ area, kind: r.kind, rule: r, framework: fw, priority: FRAMEWORK_PRIORITY[fw], targets: [...pref, ...present.filter((x) => !pref.includes(x))], why });
    }
    items.push(...byKind.good, ...byKind.bad);
  }
  merges.sort((a, b) => a.priority - b.priority);
  return { items, merges, materials, overflow };
}
