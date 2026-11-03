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
