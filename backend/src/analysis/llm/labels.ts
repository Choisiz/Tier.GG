// LLM 문장 단계(2단계)의 한국어 이름표와 단어 표. 판정을 바꾸지 않고 "말하는 법"만 정한다.
import type { AnalysisResult, LaningCauseId, LaningCellId, LaningDeathType, Role } from '../types.js';

export type Area = 'laning' | 'fight' | 'macro';
export const AREAS: readonly Area[] = ['laning', 'fight', 'macro'];

export const AREA_LABEL: Readonly<Record<Area, string>> = {
  laning: '라인전',
  fight: '오브젝트 싸움',
  macro: '그 밖의 운영',
};

/** 과목 ID → 한국어 이름 */
export const SUBJECT_LABEL: Readonly<Record<string, string>> = {
  'laning.gold': '라인전 골드',
  'laning.level': '라인전 레벨',
  'laning.kda': '라인전 킬·데스·어시스트',
  'laning.cs': '라인전 CS',
  // Q4: 라인전 판정(2-1)·데스 유형(2-3)·라인 밖 관여(2-2)
  'laning.growth': '라인전 성장(골드·레벨)',
  'laning.deaths': '라인전 데스',
  'laning.roam': '라인 밖(다른 라인·정글) 싸움 참여',
  'fight.advantage': '오브젝트 싸움 득실',
  'fight.damage': '챔피언 딜 비중',
  'fight.vision': '오브젝트 전 시야',
  'fight.objective': '오브젝트 막타',
  'macro.advantage': '오브젝트 밖 싸움 득실',
  'macro.solo': '단독 킬·데스',
  'macro.side': '사이드 압박',
  'macro.farm': '중후반 파밍',
  'macro.vision': '평소 시야',
  // Q5 B: 판단 틀 재료로 빈 칸을 채우는 항목 (등급 과목이 아님)
  'fight.initiate': '오브젝트 싸움 첫 킬 참여(이니시 추정)',
  'macro.roam': '다른 라인·정글 싸움 킬·어시스트·데스(게임 전체)',
};

/**
 * Q7(사용자 채점 2026-11-24): 기대 딜 비중(feedback_design 5-2 표)을 문장에 쓸 때 "이 유형의 기대치" 대신 포지션 이름으로 ("미드 딜러 평균 22%").
 * 값은 5-2 표 그대로(사용자 값 + 일부 칸은 200판 중앙값)이고, 사용자 결정으로 "평균"이라고 부른다.
 */
export const ROLE_AVERAGE_LABEL: Readonly<Record<Role, string>> = {
  TOP_TANK: '탑 탱커 평균',
  TOP_DAMAGE: '탑 딜러 평균',
  JUNGLE_TANK: '정글 탱커 평균',
  JUNGLE_DAMAGE: '정글 딜러 평균',
  MID_TANK: '미드 탱커 평균',
  MID_DAMAGE: '미드 딜러 평균',
  ADC: '원딜 평균',
  SUPPORT_TANK: '탱커 서포터 평균',
  SUPPORT_DAMAGE: '딜러 서포터 평균',
  SUPPORT_UTILITY: '유틸 서포터 평균',
};

/** 과목 facts 키 → [이름, 단위]. 여기 없는 키는 LLM에 넘기지 않는다 (등급·내부 점수 차단) */
export const SUBJECT_FACT_LABEL: Readonly<Record<string, readonly [string, string]>> = {
  'fight.advantage.fights': ['내가 참여한 오브젝트 싸움 수', '번'],
  // Q7: 몫(%) 대신 두 팀 점수 (킬·포탑·억제기·오브젝트, 5-4)
  'fight.advantage.ours': ['그 싸움들에서 킬·포탑·억제기·오브젝트를 점수로 합친 우리 팀 점수', '점'],
  'fight.advantage.theirs': ['그 싸움들에서 상대 팀 점수', '점'],
  'fight.damage.share0': ['0~15분 챔피언 딜 비중', '%'],
  'fight.damage.expected0': ['0~15분 포지션 평균 딜 비중 (문장에는 player.roleAverage 이름으로)', '%'],
  'fight.damage.diff0Abs': ['0~15분 딜 비중과 포지션 평균의 차이', '%p'],
  'fight.damage.share1': ['15~30분 챔피언 딜 비중', '%'],
  'fight.damage.expected1': ['15~30분 포지션 평균 딜 비중 (문장에는 player.roleAverage 이름으로)', '%'],
  'fight.damage.diff1Abs': ['15~30분 딜 비중과 포지션 평균의 차이', '%p'],
  // Q6: 30분 이후 구간 (P1·P3 칭찬, 딜 칸 템플릿이 방향에 맞는 구간을 고르려고)
  'fight.damage.share2': ['30분 이후 챔피언 딜 비중', '%'],
  'fight.damage.expected2': ['30분 이후 포지션 평균 딜 비중 (문장에는 player.roleAverage 이름으로)', '%'],
  'fight.damage.diff2Abs': ['30분 이후 딜 비중과 포지션 평균의 차이', '%p'],
  'fight.vision.objectives': ['오브젝트 수', '개'],
  'fight.vision.points': ['오브젝트 전 60초 시야 점수 합', ''],
  'fight.vision.perObjective': ['오브젝트당 시야 점수', ''],
  'fight.objective.lastHits': ['오브젝트 막타 수', '번'],
  'macro.advantage.fights': ['내가 참여한 오브젝트 밖 싸움 수', '번'],
  'macro.advantage.ours': ['그 싸움들에서 킬·포탑·억제기를 점수로 합친 우리 팀 점수', '점'],
  'macro.advantage.theirs': ['그 싸움들에서 상대 팀 점수', '점'],
  'macro.solo.kills': ['단독 킬', '번'],
  'macro.solo.deaths': ['단독 데스', '번'],
  'macro.solo.netAbs': ['단독 킬과 데스의 차이', '번'],
  'macro.side.turretDamage': ['포탑 피해량', ''],
  'macro.side.perMinute': ['분당 포탑 피해량', ''],
  'macro.farm.cs15': ['15분 CS', '개'],
  'macro.farm.csEnd': ['게임 끝 CS', '개'],
  'macro.farm.minutes': ['15분 이후 시간', '분'],
  'macro.farm.perMinute': ['15분 이후 분당 CS', '개'],
  'macro.vision.points': ['오브젝트 싸움 밖 시야 점수 합', ''],
  'macro.vision.minutes': ['게임 시간', '분'],
  'macro.vision.perMinute': ['분당 시야 점수', ''],
};

type LaningVerdict = NonNullable<AnalysisResult['summary']['laning']>;
type AreaVerdict = NonNullable<AnalysisResult['summary']['fight']>;

/** 요약 판정어 → 허용 표현(어간). 요약 문장에 하나는 있어야 한다 */
export const VERDICT_WORDS: Readonly<Record<LaningVerdict | AreaVerdict, readonly string[]>> = {
  우세: ['우세', '앞섰', '앞서'],
  열세: ['열세', '밀렸', '뒤졌', '뒤처', '뒤쳐', '밀리'],
  비슷: ['비슷', '팽팽', '대등'],
  잘함: ['잘했', '잘함', '좋았', '뛰어났', '훌륭'],
  보통: ['보통', '무난'],
  부족: ['부족', '아쉬', '약했'],
};

/** 판정어마다 "반대 방향" 판정어 */
export const VERDICT_OPPOSITE: Readonly<Record<LaningVerdict | AreaVerdict, readonly (LaningVerdict | AreaVerdict)[]>> = {
  우세: ['열세'],
  열세: ['우세'],
  비슷: ['우세', '열세'],
  잘함: ['부족'],
  보통: [],
  부족: ['잘함'],
};

/**
 * 라인전 요약 판정어 (Q4, 2-1 칸마다). 요약 문장에 하나는 있어야 하고(words), 반대 방향 말(opposite)이 있으면 실패.
 * 골드·레벨이 엇갈린 칸(잘 따라감)은 반대 방향 검사를 하지 않는다 (앞선 쪽과 뒤진 쪽을 함께 말해야 해서).
 */
export const LANING_CELL_WORDS: Readonly<Record<LaningCellId, { words: readonly string[]; opposite: readonly string[] }>> = {
  LEAD: { words: ['우위', '우세', '앞섰', '앞서'], opposite: ['열세', '밀렸', '라인전 패배', '라인전에서 졌'] },
  GOLD_LEAD: { words: ['우위', '우세', '앞섰', '앞서'], opposite: ['열세', '밀렸', '라인전 패배', '라인전에서 졌'] },
  LEVEL_LEAD: { words: ['우위', '우세', '앞섰', '앞서'], opposite: ['열세', '밀렸', '라인전 패배', '라인전에서 졌'] },
  GAP_COVERED: { words: ['잘 따라갔', '잘 따라감', '격차를 따라', '만회'], opposite: [] },
  BASICS_KEPT: { words: ['기본기', '잘 따라갔', '잘 따라감'], opposite: [] },
  EVEN: { words: ['비슷', '팽팽', '대등'], opposite: ['우위', '우세', '열세', '라인전 패배'] },
  LEVEL_BEHIND: { words: ['레벨이 뒤', '레벨은 뒤', '레벨에서 뒤', '열세', '밀렸'], opposite: ['우위', '우세'] },
  XP_KEPT_GOLD_LOST: { words: ['골드를 내', '골드는 내', '골드를 뺏', '골드가 뒤', '골드는 뒤', '골드에서 뒤', '열세', '밀렸'], opposite: ['우위', '우세'] },
  LOST: { words: ['라인전 패배', '라인전에서 졌', '라인전은 졌', '열세', '밀렸', '밀리'], opposite: ['우위', '우세'] },
};

/** 2-3 데스 유형 이름 (DIVE는 추정) */
export const DEATH_TYPE_LABEL: Readonly<Record<LaningDeathType, string>> = {
  SOLO: '1:1',
  GANK: '갱',
  ROAM: '로밍 당함',
  DIVE: '다이브',
  OTHER: '그 밖의 데스',
  // Q5(C3) 정글
  JUNGLE_SOLO: '상대 정글과 1:1',
  OUTNUMBERED: '수적 열세',
};

/** 1장 골드 분해 원인 이름 */
export const CAUSE_LABEL: Readonly<Record<LaningCauseId, string>> = {
  killGold: '킬 골드',
  cs: 'CS',
  plates: '포탑 방패',
  deaths: '데스',
  outOfLane: '다른 라인·정글 싸움 참여',
};

/** 결정적 장면 방향 단어 */
export const DIRECTION_WORDS: Readonly<Record<'widened' | 'narrowed', readonly string[]>> = {
  widened: ['벌어', '커지', '커졌', '기울'],
  narrowed: ['좁혀', '줄어', '줄었', '따라잡', '따라붙'],
};

/** 앞선 팀이 바뀐 결정적 장면에 있어야 하는 말 (역전 장면에는 벌어/좁혀 대신 이 말을 쓴다) */
export const REVERSAL_WORDS: readonly string[] = ['바뀌', '바뀐', '뒤집', '역전', '넘어갔', '넘어간'];

/** 결정적 장면에서 우리 팀이 골드를 얻었는지/잃었는지 말하는 단어. 반대쪽 단어가 있으면 실패 */
export const SWING_WORDS: Readonly<Record<'gain' | 'loss', readonly string[]>> = {
  gain: ['이득'],
  loss: ['손해'],
};

/**
 * 좋은 점·부족한 점 칸의 방향 단어 (과목마다). good = 잘했다는 뜻, bad = 부족했다는 뜻.
 * 좋은 점 칸에 bad 단어, 부족한 점 칸에 good 단어가 있으면 실패.
 * 데스가 섞인 과목(KDA·단독 킬/데스)은 "많았·적었"이 뒤집히므로 그 말을 빼고 따로 둔다.
 */
const MORE_IS_GOOD = { good: ['많았', '높았', '앞섰'], bad: ['적었', '낮았', '뒤졌', '뒤처', '그쳤'] } as const;
const SHARE = { good: ['컸', '높았', '많았'], bad: ['그쳤', '작았', '낮았', '적었'] } as const;
export const SUBJECT_DIRECTION_WORDS: Readonly<Record<string, { good: readonly string[]; bad: readonly string[] }>> = {
  'laning.gold': MORE_IS_GOOD,
  'laning.cs': MORE_IS_GOOD,
  'laning.level': MORE_IS_GOOD,
  'laning.kda': { good: ['좋았', '앞섰', '높았'], bad: ['나빴', '뒤졌', '뒤처', '낮았'] },
  'fight.advantage': SHARE,
  'fight.damage': SHARE,
  'fight.vision': { good: ['높았', '많았'], bad: ['낮았', '적었', '그쳤'] },
  'fight.objective': { good: ['많았'], bad: ['못했', '적었', '그쳤'] },
  'macro.advantage': SHARE,
  'macro.side': { good: ['높았', '컸', '많았', '좋았'], bad: ['낮았', '약했', '적었', '그쳤'] },
  'macro.farm': MORE_IS_GOOD,
  'macro.vision': { good: ['높았', '많았'], bad: ['낮았', '적었', '그쳤'] },
  // 데스는 적을수록 좋다: "데스가 적었" = 좋음, "데스가 많았" = 부족
  'macro.solo': { good: ['좋았', '앞섰', '킬이 많', '데스가 적', '데스는 적'], bad: ['나빴', '밀렸', '데스가 많', '데스는 많', '데스가 더 많', '킬이 적', '킬은 적'] },
};

/** 데스를 말하는 구절. 데스가 주인공이 아닌 과목의 방향 검사에서는 이 구절을 지우고 본다 ("그 전 데스가 많았습니다") */
export const DEATH_CLAUSE = /데스[가는이도]?\s*(?:더\s*)?(?:많았|적었)/g;

/** 숫자 바로 뒤에 오면 단위로 읽는 말 (긴 것부터) */
export const UNIT_WORD_RE = /^\s?(%p|%포인트|%|골드|킬|데스|어시스트|CS|cs|개|번(?!째)|회|분(?!당|석|명)|초(?!반)|레벨|점(?![수유령]))/;

/**
 * fact별 허용 단위어. 기본은 fact.unit에서 정하고, 아래 표의 id 패턴이 맞으면 그 목록을 쓴다.
 * 숫자 뒤에 단위어가 있으면 그 숫자와 맞은 fact 중 하나는 그 단위를 허용해야 한다 (예: 팀 킬 5를 "5데스"로 쓰면 실패).
 */
const UNIT_BY_FACT: readonly { re: RegExp; units: readonly string[] }[] = [
  { re: /^keyMoment\.\d+\.(kills|killsOurs|killsTheirs)$/, units: ['킬', '개', '번'] },
  { re: /^laning\.kda\.(me|enemy)\.kills$/, units: ['킬', '번', '회'] },
  { re: /^laning\.kda\.(me|enemy)\.deaths$/, units: ['데스', '번', '회'] },
  { re: /^laning\.kda\.(me|enemy)\.assists$/, units: ['어시스트', '번', '회'] },
  { re: /^laning\.deathsBefore\.count$/, units: ['번', '회', '데스'] },
  // Q5 A1: 라인전 킬/데스/어시스트 (laning.kda.me.kills 등, 위 규칙과 같은 단위)
  { re: /^rule\.R4\.(good|bad)\.myDeaths$/, units: ['번', '회', '데스'] },
  { re: /^fight\.initiate\.count$/, units: ['번', '회'] },
  { re: /^laning\.level\./, units: ['레벨'] },
  { re: /^(laning\.cs|macro\.farm\.(cs15|csEnd|perMinute))(\.|$)/, units: ['개', 'CS'] },
  { re: /^macro\.solo\.kills$/, units: ['번', '회', '킬'] },
  { re: /^macro\.solo\.deaths$/, units: ['번', '회', '데스'] },
  { re: /^fight\.objective\.lastHits$/, units: ['번', '회', '개'] },
  // Q4 라인전 원인·데스·로밍
  { re: /^laning\.cause\.killGold\.(enemyKills|meKills)$/, units: ['킬', '번', '회'] },
  { re: /^laning\.cause\.killGold\.(enemyAssistsOnMe|enemyKillsOnMe|enemyOutOfLane)$/, units: ['번', '회'] },
  { re: /^laning\.cause\.cs\./, units: ['개', 'CS'] },
  { re: /^laning\.cause\.deaths\./, units: ['번', '회', '데스'] },
  { re: /^laning\.deathType\.[A-Z]+\.count$/, units: ['번', '회'] },
  { re: /^laning\.deathsBefore\.\d+\.wardsBefore$/, units: ['개'] },
  { re: /^(rule\.R7\.wardsBefore|rule\.R11\.(controlWards|wardsPlaced))$/, units: ['개'] },
  { re: /^rule\.R8\.(me|enemy)$/, units: ['골드', '개', 'CS', '번', '회', '데스'] },
  { re: /^macro\.roam\.(me|enemy)\.kills$/, units: ['킬', '번', '회'] },
  { re: /^macro\.roam\.(me|enemy)\.deaths$/, units: ['데스', '번', '회'] },
  { re: /^macro\.roam\.(me|enemy)\.assists$/, units: ['어시스트', '번', '회'] },
  // Q6 칭찬 규칙
  { re: /^rule\.(P2\.count|P3\.kills\.lateCount)$/, units: ['번', '회', '킬'] },
  { re: /^rule\.P4\.fights$/, units: ['번', '회'] },
  // Q7 라인전 킬 관여 · 오브젝트 싸움 내 기여
  { re: /^laning\.involve\.(me|enemy)\.kills$/, units: ['킬', '번', '회'] },
  { re: /^laning\.involve\.(me|enemy)\.assists$/, units: ['어시스트', '번', '회'] },
  { re: /^laning\.involve\.(me|enemy)\.(count|vsLaner|inLane)$/, units: ['번', '회'] },
  { re: /^rule\.(P4|R12)\.teamKills$/, units: ['킬', '번', '개'] },
  { re: /^rule\.(P4|R12)\.involvement$/, units: ['번', '회'] },
  // 장면 (Q2)
  { re: /^scene\.[a-z.]+\.\d+\.(killsOurs|killsTheirs)$/, units: ['킬', '개', '번'] },
  { re: /^scene\.[a-z.]+\.\d+\.(wardsPlaced|controlWards)$/, units: ['개'] },
  { re: /^scene\.[a-z.]+\.\d+\.wardKills$/, units: ['개', '번'] },
];
const UNIT_DEFAULT: Readonly<Record<string, readonly string[]>> = {
  골드: ['골드'],
  분: ['분'],
  '%': ['%'],
  '%p': ['%p', '%포인트'],
  개: ['개'],
  번: ['번', '회'],
  초: ['초'],
  점: ['점'],
};

/** 이 fact 숫자 바로 뒤에 써도 되는 단위어 (비어 있으면 단위어를 붙이지 않는다) */
export function allowedUnitWords(factId: string, unit: string): readonly string[] {
  return UNIT_BY_FACT.find((x) => x.re.test(factId))?.units ?? UNIT_DEFAULT[unit] ?? [];
}

/** 데이터가 직접 말하지 않는 해석어. 있으면 "보입니다"로 끝맺어야 한다 */
export const INTERPRETIVE_WORDS: readonly string[] = ['이니시', '버스', '캐리', '무리', '던지', '던졌', '실수', '판단', '집중력', '욕심', '다이브'];

/**
 * Q6 칭찬 말 (규칙마다). 이 말은 그 칭찬 규칙이 발동한 칸에서만, 규칙의 근거 fact를 인용할 때만 쓴다(검증기).
 * P1 "캐리"는 해석어(INTERPRETIVE_WORDS)지만 P1 칸에서는 데이터가 정한 칭찬이라 "~것으로 보입니다" 없이 쓴다.
 * 말투는 사용자 결정 ①(2026-11-22): 담백 + 게임 용어("캐리했습니다", "게임을 주도했습니다").
 */
export const PRAISE_WORDS: Readonly<Record<string, readonly string[]>> = {
  P1: ['캐리'],
  P3: ['주도', '후반으로 갈수록 강해', '후반에 뒤집'],
};

/**
 * Q6 커뮤니티 말투 (사용자 결정 ①: 담백 + 게임 용어만). 칭찬 칸뿐 아니라 모든 칸에서 금지한다 — 피드백 문체(~습니다)에 맞지 않고,
 * "딜량 머신"·"하드캐리"처럼 데이터보다 센 말이라 근거 인용으로 정당화할 수 없다.
 */
export const SLANG_RE = /딜량?\s*머신|캐리\s*머신|하드\s*캐리|멱살|원맨쇼|폼\s*미쳤|개사기|사기\s*캐릭|찢었|씹어\s*먹/;

/** 추정 fact를 쓴 문장의 끝맺음 (Q4: 데이터가 강하게 시사하지만 확정하지 못하는 값은 "~로 보입니다") */
export const ESTIMATE_ENDING = '보입니다';

/** 숫자 검사에서 빼는 이름 속 숫자 (예: "1차 포탑", Q5: 챔피언 이름 "자르반 4세") */
export const NUMBER_NAME_PATTERNS: readonly RegExp[] = [/[123]차\s*포탑/g, /1\s*[대:]\s*1/g, /6\s*레벨/g, /자르반\s*4세/g];

/**
 * 은어·막연한 조언 표현 (Q2). LLM 문장과 지식 조각 모두에서 막는다.
 * "낀"(싸움에 끼다)은 뜻이 모호해 "내가 참여한"으로 쓴다. "~해 볼 수 있습니다"·"이어 가 볼 수"는 할 일이 정해지지 않은 말이다.
 */
export const VAGUE_PATTERNS: readonly { re: RegExp; why: string }[] = [
  { re: /(?<!느)(?:낀|꼈)/, why: '은어 "낀" (→ "내가 참여한")' },
  { re: /볼\s*수\s*있/, why: '막연한 조언 "~해 볼 수 있습니다" (→ 언제·어디서·무엇을 하라고 쓴다)' },
  { re: /이어\s*가/, why: '막연한 조언 "이어 가" (→ 구체 행동으로 쓴다)' },
];

/**
 * 조언 문장 표시 (Q3). 하나라도 있으면 조언 문장으로 본다: "다음 판", 명령형 "~세요"·"~라"(해라·챙겨라), "신경 써/쓰".
 * 조언 문장은 그 칸에서 행동 조언 규칙(R1·R2·R3·R5)이 발동했을 때만, 그 규칙의 근거 fact를 인용해야 통과한다.
 */
// 명령형 "~라"(해라·챙겨라·둬라): 문장 끝이 "라"인 말. 피드백 문체(~습니다)에서는 명령형 말고는 "라"로 끝나지 않는다
export const ADVICE_SENTENCE: readonly RegExp[] = [/다음\s*판/, /세요\s*[.!]?\s*$/, /라\s*[.!]?\s*$/, /신경\s*(?:써|쓰)/];

/** 장면 fact ID: scene.* 와 라인전 데스 시각·지역 */
export const isSceneFactId = (id: string): boolean => id.startsWith('scene.') || /^laning\.deathsBefore\.\d+\./.test(id);

/** 5-4-1 첫 데스 해석 문장 (fight.ts FIRST_DEATH_TEXT와 같은 문장). stem이 문장에 나오면 R4 문장으로 본다 */
export const FIRST_DEATH_SENTENCES: readonly { stem: string; full: string }[] = [
  { stem: '이니시를 걸어 싸움을 연', full: '이니시를 걸어 싸움을 연 것으로 보입니다' },
  { stem: '혼자 들어갔거나 팀이 따라오지 못한', full: '혼자 들어갔거나 팀이 따라오지 못한 것으로 보입니다' },
  { stem: '먼저 잡혀 싸움을 졌', full: '먼저 잡혀 싸움을 졌습니다' },
  { stem: '먼저 잡혔지만 팀이 받아쳐', full: '먼저 잡혔지만 팀이 받아쳐 이겼습니다' },
];

/** R4의 내 역할 문장 (advice.ts r4DiedText·R4_SURVIVED_TEXT·r4TradeText). stem이 문장에 나오면 그 칸 R4 문장 그대로여야 한다 */
export const R4_ME_STEMS: readonly string[] = ['나도 죽어 상대 팀이', '나는 살아남았습니다', '이득 교환'];

const SCORE_RE = /(?<!시야\s?)점수/;
const N_POINT_RE = /\d\s*점(?![수유령])/;
const WEIGHT_RE = /반영\s*비율/;

/** 금지 표현 (등급·점수·총점·반영 비율 + Q2 은어·막연한 조언) */
export const FORBIDDEN_PATTERNS: readonly { re: RegExp; why: string }[] = [
  ...VAGUE_PATTERNS,
  { re: SLANG_RE, why: '커뮤니티 말투 (Q6 결정 ①: 담백 + 게임 용어만, "딜량 머신"·"하드캐리" 등 금지)' },
  { re: /등급/, why: '등급 언급' },
  { re: /총점/, why: '총점 언급' },
  { re: SCORE_RE, why: '점수 언급 (시야 점수 제외)' },
  { re: N_POINT_RE, why: '"N점" 표기' },
  { re: WEIGHT_RE, why: '반영 비율 언급' },
  { re: /가중치/, why: '가중치 언급' },
  // Q7(사용자 채점 2026-11-24): "이 유형의 기대치" → 포지션 이름 평균 ("미드 딜러 평균 22%")
  { re: /이\s*유형의?\s*기대|기대치/, why: '"이 유형의 기대치"·"기대치" (→ 포지션 이름 평균, 예: "미드 딜러 평균")' },
  { re: /(?:^|[^A-Za-z])[A-E](?:\s*(?:등급|학점|를 받|을 받))/, why: '등급 글자' },
];

/**
 * 규칙이 발동한 칸에서만 풀어 주는 금지 표현 (Q3). R1은 "이 유형은 ○○ 비중이 크다(반영 비율 N)"와 막타 점수,
 * R2·R3은 "내 데스로 상대 팀이 얻은 득실 점수 N점"을 말해야 해서. 등급·총점·가중치는 그대로 금지.
 */
export const RULE_EXEMPT_PATTERNS: Readonly<Partial<Record<string, readonly RegExp[]>>> = {
  R1: [WEIGHT_RE, SCORE_RE, N_POINT_RE],
  R2: [SCORE_RE, N_POINT_RE],
  R3: [SCORE_RE, N_POINT_RE],
  // R4 "나도 죽어 상대 팀이 N점을 얻었습니다" (2026-11-15)
  R4: [N_POINT_RE],
  // Q7: 오브젝트 싸움 두 팀 점수 ("점수로 합치면 우리 팀 363점, 상대 팀 76점")
  P4: [SCORE_RE, N_POINT_RE],
  R12: [SCORE_RE, N_POINT_RE],
};

/**
 * Q7: 과목 칸에서 풀어 주는 금지 표현. 득실 과목은 몫(%) 대신 두 팀 점수로 말해서 "점수"·"N점"을 쓴다
 * (등급·총점·가중치·반영 비율은 그대로 금지)
 */
export const SUBJECT_EXEMPT_PATTERNS: Readonly<Partial<Record<string, readonly RegExp[]>>> = {
  'fight.advantage': [SCORE_RE, N_POINT_RE],
  'macro.advantage': [SCORE_RE, N_POINT_RE],
};

/** 이어진 일(followUps) 문장 조각. "이어서 ~"에 붙여 쓰는 존댓말 절 */
export function followUpLabel(what: string, ours: boolean): string {
  const [kind, lane, tower] = what.split(':');
  const laneName: Record<string, string> = { TOP_LANE: '탑 ', MID_LANE: '미드 ', BOT_LANE: '바텀 ' };
  const towerName: Record<string, string> = {
    OUTER_TURRET: '1차 포탑을',
    INNER_TURRET: '2차 포탑을',
    BASE_TURRET: '3차 포탑을',
    NEXUS_TURRET: '넥서스 포탑을',
  };
  const l = laneName[lane ?? ''] ?? '';
  if (kind === 'TOWER_BUILDING') {
    const t = towerName[tower ?? ''] ?? '포탑을';
    return ours ? `상대 ${l}${t} 깼습니다` : `우리 ${l}${t} 잃었습니다`;
  }
  if (kind === 'INHIBITOR_BUILDING') return ours ? `상대 ${l}억제기를 깼습니다` : `우리 ${l}억제기를 잃었습니다`;
  const monster: Record<string, string> = {
    DRAGON: '용을',
    BARON_NASHOR: '바론을',
    RIFTHERALD: '전령을',
    HORDE: '공허 유충을',
    ATAKHAN: '아타칸을',
  };
  const m = monster[kind ?? ''] ?? '오브젝트를';
  return ours ? `우리 팀이 ${m} 잡았습니다` : `상대 팀이 ${m} 잡았습니다`;
}

// ---------- 장면 (Q2) ----------

/** 지도 지역 → 한국어 (내 팀 기준. 위 = 탑 쪽, 아래 = 바텀 쪽) */
export const REGION_LABEL: Readonly<Record<string, string>> = {
  OUR_BASE: '우리 기지 근처',
  ENEMY_BASE: '상대 기지 근처',
  TOP_LANE_OURS: '탑 라인 우리 포탑 쪽',
  TOP_LANE_THEIRS: '탑 라인 상대 포탑 쪽',
  MID_LANE_OURS: '미드 라인 우리 포탑 쪽',
  MID_LANE_THEIRS: '미드 라인 상대 포탑 쪽',
  BOT_LANE_OURS: '바텀 라인 우리 포탑 쪽',
  BOT_LANE_THEIRS: '바텀 라인 상대 포탑 쪽',
  RIVER_TOP: '위쪽 강(바론 쪽)',
  RIVER_BOT: '아래쪽 강(용 쪽)',
  OUR_JUNGLE_TOP: '우리 정글 위쪽(탑 쪽)',
  OUR_JUNGLE_BOT: '우리 정글 아래쪽(바텀 쪽)',
  ENEMY_JUNGLE_TOP: '상대 정글 위쪽(탑 쪽)',
  ENEMY_JUNGLE_BOT: '상대 정글 아래쪽(바텀 쪽)',
};

/** 오브젝트 종류 → 한국어 */
export const OBJECTIVE_LABEL: Readonly<Record<string, string>> = {
  DRAGON: '용',
  SOUL_DRAGON: '영혼 용',
  ELDER_DRAGON: '장로 용',
  BARON: '바론',
  RIFTHERALD: '전령',
  HORDE: '공허 유충',
};

/** 싸움 하나에서 나 (장면 facts·R4 facts). 다른 아군이 먼저 죽은 일은 말하지 않는다 (2026-11-15 사용자 결정: 피드백은 내 역할만) */
export const MY_FIGHT_LABEL = {
  FIRST: '내가 먼저 죽음',
  DIED: '나도 죽음',
  SURVIVED: '나는 살아남음',
} as const;
