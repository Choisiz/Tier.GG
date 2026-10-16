/* ───────── Data Dragon 원본 응답 타입 (사용하는 필드만) ───────── */

/** 역할군 (포지션 아님). 화면 표시용 한글 이름은 transform.ts의 `TAG_LABELS` */
export type ChampionTag =
  | "Fighter"
  | "Tank"
  | "Mage"
  | "Assassin"
  | "Marksman"
  | "Support";

/** 이미지 정보. `full` = 파일명 (예: "Aatrox.png") */
export type DDragonImage = { full: string };

/** champion.json의 챔피언 1명 (목록용 요약) */
export type DDragonChampionSummary = {
  /** "Aatrox" (URL·이미지용) */
  id: string;
  /** 숫자 ID(문자열) "266". 백엔드 API의 championId와 대응 */
  key: string;
  /** "아트록스" */
  name: string;
  /** 칭호 "다르킨의 검" (페이지 제목 아님) */
  title: string;
  /** 역할군 (1~2개) */
  tags: ChampionTag[];
  /** 공격·방어·마법·난이도 수치 (0~10) */
  info: { attack: number; defense: number; magic: number; difficulty: number };
  image: DDragonImage;
};

/** champion.json 응답 */
export type DDragonChampionListResponse = {
  version: string;
  /** 키 = 챔피언 id ("Aatrox") */
  data: Record<string, DDragonChampionSummary>;
};

/** 챔피언 상세의 스킨 1개 */
export type DDragonSkin = {
  /** 스킨 고유 ID "266000" (챔피언 key × 1000 + num) */
  id: string;
  /** 스킨 번호. 이미지 URL의 {id}_{num}에 사용, 기본 스킨 = 0 */
  num: number;
  /** 스킨 이름. 기본 스킨은 "default" */
  name: string;
  /** 크로마(색상 변형) 보유 여부 */
  chromas: boolean;
  /** 크로마 스킨에만 존재 */
  parentSkin?: number;
};

/** 챔피언 패시브 */
export type DDragonPassive = {
  name: string;
  description: string;
  image: DDragonImage;
};

/** 챔피언 스킬(Q/W/E/R). Data Dragon 원본 필드명이 `spells`라 혼동 주의 (소환사 주문 아님) */
export type DDragonChampionSkill = {
  id: string;
  name: string;
  /** HTML 태그 포함 설명 */
  description: string;
  /** 레벨별 재사용 대기시간 "14/12/10/8/6" */
  cooldownBurn: string;
  image: DDragonImage;
};

/** champion/{id}.json의 챔피언 상세 (요약 필드 + 상세 필드) */
export type DDragonChampionDetail = DDragonChampionSummary & {
  /** 배경 스토리 (HTML 포함) */
  lore: string;
  /** 크로마 포함 전체 스킨 */
  skins: DDragonSkin[];
  passive: DDragonPassive;
  /** 챔피언 스킬 Q/W/E/R (Data Dragon 원본 필드명) */
  spells: DDragonChampionSkill[];
};

/** champion/{id}.json 응답 */
export type DDragonChampionDetailResponse = {
  version: string;
  /** 키 = 챔피언 id 1개 */
  data: Record<string, DDragonChampionDetail>;
};

/** item.json의 아이템 1개 (사용하는 필드만) */
export type DDragonItem = {
  name: string;
  /** "Boots", "Consumable", "Trinket" 등 */
  tags?: string[];
  /** 이 아이템으로 만드는 상위 아이템 (있으면 하위 재료) */
  into?: string[];
  /** 이 아이템의 재료 (없으면 기본 아이템) */
  from?: string[];
  gold: { total: number };
  image: DDragonImage;
};

/** item.json 응답. 키 = 아이템 ID 문자열 ("3047") */
export type DDragonItemListResponse = {
  data: Record<string, DDragonItem>;
};

/** summoner.json의 소환사 주문 1개 */
export type DDragonSummonerSpell = {
  /** 문자열 id "SummonerFlash" */
  id: string;
  /** 숫자 ID(문자열) "4". 백엔드 spellIds와 대응 */
  key: string;
  name: string;
  image: DDragonImage;
};

/** summoner.json 응답. 키 = 문자열 id */
export type DDragonSummonerSpellListResponse = {
  data: Record<string, DDragonSummonerSpell>;
};

/** runesReforged.json의 룬 1개 */
export type DDragonRune = {
  id: number;
  name: string;
  /** "perk-images/Styles/..." (버전 없는 경로) */
  icon: string;
};

/** runesReforged.json의 룬 트리 1개 (정밀·지배 등) */
export type DDragonRuneTree = {
  id: number;
  name: string;
  icon: string;
  /** 0번 = 핵심 룬 줄, 1~3번 = 일반 룬 줄 */
  slots: { runes: DDragonRune[] }[];
};

/* ───────── 화면용 가공 타입 ───────── */

/** 화면용 챔피언 요약 (리스트 카드) */
export type ChampionSummary = {
  /** 영문 id "Aatrox" (상세 URL에 사용) */
  id: string;
  /** 숫자 ID(문자열) "266". 백엔드 API 호출·매핑에 사용 */
  key: string;
  /** 한글 이름 */
  name: string;
  /** 칭호 */
  title: string;
  /** 역할군 */
  tags: ChampionTag[];
  /** 스퀘어 아이콘 URL */
  iconUrl: string;
};

/** 스킬 키. P = 패시브 */
export type AbilityKey = "P" | "Q" | "W" | "E" | "R";

/** 화면용 스킬 1개 (패시브 포함) */
export type ChampionAbility = {
  key: AbilityKey;
  name: string;
  /** HTML 제거된 텍스트 */
  description: string;
  /** "14/12/10/8/6" (패시브는 없음) */
  cooldown?: string;
  iconUrl: string;
};

/** 화면용 스킨 1개 */
export type ChampionSkin = {
  /** 스킨 번호 (기본 = 0) */
  num: number;
  /** "default" → "기본" */
  name: string;
  /** 가로형 큰 이미지 URL (미리보기) */
  splashUrl: string;
  /** 세로형 이미지 URL (그리드 카드) */
  loadingUrl: string;
};

/** 화면용 챔피언 상세 */
export type ChampionDetail = ChampionSummary & {
  /** 난이도 0~10 */
  difficulty: number;
  /** 스토리 (HTML 제거된 텍스트) */
  lore: string;
  /** [P, Q, W, E, R] */
  abilities: ChampionAbility[];
  /** parentSkin 없는 것만, num 오름차순 */
  skins: ChampionSkin[];
};

/** ID로 찾는 아이템 정보 (itemFilter·화면 매핑용) */
export type ItemInfo = {
  name: string;
  iconUrl: string;
  tags: string[];
  /** 상위 아이템이 있음 = 하위 재료 */
  hasInto: boolean;
  /** 재료가 있음 */
  hasFrom: boolean;
  /**
   * 재료 중에 `Boots` 태그 아이템이 있음 (3단계 신발).
   * 건메탈 군화 `3172`는 3단계 신발인데 태그에 `Boots`가 없어(`NonbootsMovement`) 태그만으로는 못 찾는다.
   */
  builtFromBoots: boolean;
  goldTotal: number;
};

/** ID로 찾는 소환사 주문·룬 정보 */
export type IconInfo = {
  name: string;
  iconUrl: string;
};

/** 화면용 룬 트리 (줄별 룬 목록) */
export type RuneTreeInfo = IconInfo & {
  id: number;
  /** 0번 = 핵심 룬 줄 */
  rows: { id: number; name: string; iconUrl: string }[][];
};
