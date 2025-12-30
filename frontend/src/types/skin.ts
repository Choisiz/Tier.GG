// 스킨 관련 타입 정의

/** Data Dragon 원본 스킨 데이터 */
export interface RawChampionSkin {
  id: string;
  num: number;
  name: string;
  chromas?: boolean;
}

/** Data Dragon 원본 챔피언 데이터 */
export interface RawChampionData {
  id: string;
  key: string;
  name: string;
  title: string;
  skins: RawChampionSkin[];
}

/** 변환된 챔피언 스킨 데이터 */
export interface ChampionSkinData {
  id: string;
  num: number;
  name: string;
  splashUrl: string;
  loadingUrl: string;
  chromas?: boolean;
}

/** 챔피언 스킨 API 응답 */
export interface ChampionSkinsResponse {
  championId: string;
  championName: string;
  skins: ChampionSkinData[];
}
