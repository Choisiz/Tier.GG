// LLM 문장 단계(2단계)의 한국어 이름표와 단어 표. 판정을 바꾸지 않고 "말하는 법"만 정한다.
import type { AnalysisResult } from '../types.js';

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
  'fight.advantage': '오브젝트 싸움 득실',
  'fight.damage': '챔피언 딜 비중',
  'fight.vision': '오브젝트 전 시야',
  'fight.objective': '오브젝트 막타',
  'macro.advantage': '오브젝트 밖 싸움 득실',
  'macro.solo': '단독 킬·데스',
  'macro.side': '사이드 압박',
  'macro.farm': '중후반 파밍',
  'macro.vision': '평소 시야',
};

/** 과목 facts 키 → [이름, 단위]. 여기 없는 키는 LLM에 넘기지 않는다 (등급·내부 점수 차단) */
export const SUBJECT_FACT_LABEL: Readonly<Record<string, readonly [string, string]>> = {
  'fight.advantage.fights': ['낀 오브젝트 싸움 수', '번'],
  'fight.advantage.sharePct': ['오브젝트 싸움 득실 중 우리 팀 몫', '%'],
  'fight.damage.share0': ['0~15분 챔피언 딜 비중', '%'],
  'fight.damage.expected0': ['0~15분 이 유형의 기대 딜 비중', '%'],
  'fight.damage.diff0Abs': ['0~15분 딜 비중과 기대 비중의 차이', '%p'],
  'fight.damage.share1': ['15분 이후 챔피언 딜 비중', '%'],
  'fight.damage.expected1': ['15분 이후 이 유형의 기대 딜 비중', '%'],
  'fight.damage.diff1Abs': ['15분 이후 딜 비중과 기대 비중의 차이', '%p'],
  'fight.vision.objectives': ['오브젝트 수', '개'],
  'fight.vision.points': ['오브젝트 전 60초 시야 점수 합', ''],
  'fight.vision.perObjective': ['오브젝트당 시야 점수', ''],
  'fight.objective.lastHits': ['오브젝트 막타 수', '번'],
  'macro.advantage.fights': ['낀 오브젝트 밖 싸움 수', '번'],
  'macro.advantage.sharePct': ['오브젝트 밖 싸움 득실 중 우리 팀 몫', '%'],
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
export const UNIT_WORD_RE = /^\s?(%p|%포인트|%|골드|킬|데스|어시스트|CS|cs|개|번(?!째)|회|분(?!당|석|명)|초(?!반)|레벨)/;

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
  { re: /^laning\.level\./, units: ['레벨'] },
  { re: /^(laning\.cs|macro\.farm\.(cs15|csEnd|perMinute))(\.|$)/, units: ['개', 'CS'] },
  { re: /^macro\.solo\.kills$/, units: ['번', '회', '킬'] },
  { re: /^macro\.solo\.deaths$/, units: ['번', '회', '데스'] },
  { re: /^fight\.objective\.lastHits$/, units: ['번', '회', '개'] },
];
const UNIT_DEFAULT: Readonly<Record<string, readonly string[]>> = {
  골드: ['골드'],
  분: ['분'],
  '%': ['%'],
  '%p': ['%p', '%포인트'],
  개: ['개'],
  번: ['번', '회'],
};

/** 이 fact 숫자 바로 뒤에 써도 되는 단위어 (비어 있으면 단위어를 붙이지 않는다) */
export function allowedUnitWords(factId: string, unit: string): readonly string[] {
  return UNIT_BY_FACT.find((x) => x.re.test(factId))?.units ?? UNIT_DEFAULT[unit] ?? [];
}

/** 데이터가 직접 말하지 않는 해석어. 있으면 "보입니다"로 끝맺어야 한다 */
export const INTERPRETIVE_WORDS: readonly string[] = ['이니시', '버스', '캐리', '무리', '던지', '던졌', '실수', '판단', '집중력', '욕심'];

/** 숫자 검사에서 빼는 이름 속 숫자 (예: "1차 포탑") */
export const NUMBER_NAME_PATTERNS: readonly RegExp[] = [/[123]차\s*포탑/g, /1\s*[대:]\s*1/g];

/** 금지 표현 (등급·점수·총점·반영 비율) */
export const FORBIDDEN_PATTERNS: readonly { re: RegExp; why: string }[] = [
  { re: /등급/, why: '등급 언급' },
  { re: /총점/, why: '총점 언급' },
  { re: /(?<!시야\s?)점수/, why: '점수 언급 (시야 점수 제외)' },
  { re: /\d\s*점(?![수유령])/, why: '"N점" 표기' },
  { re: /반영\s*비율|가중치/, why: '반영 비율 언급' },
  { re: /(?:^|[^A-Za-z])[A-E](?:\s*(?:등급|학점|를 받|을 받))/, why: '등급 글자' },
];

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
