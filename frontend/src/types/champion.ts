// 챔피언 관련 타입 정의

/** 포지션/티어 상세 정보 */
export interface TierDetail {
  tier: string;
  position: string;
  pickCount: number;
  winCount: number;
  pickRate: number;
  winRate: number;
  banRate: number;
  items: number[];
  primaryRunes: number[];
  subRunes: number[];
}

/** 포지션별 상세 정보 (일부 필드 optional) */
export interface PositionDetail {
  tier: string | null;
  pickCount?: number | null;
  winCount?: number | null;
  pickRate?: number | null;
  winRate?: number | null;
  banRate?: number | null;
  items?: number[];
  primaryRunes?: number[];
  subRunes?: number[];
}

/** 챔피언 티어 리스트 아이템 */
export interface ChampionTierItem {
  name: string;
  url: string;
  championId?: number;
  tier: string | null;
  positionDetails: Record<string, TierDetail>;
  pickCount: number | null;
  winCount: number | null;
  pickRate: number | null;
  winRate: number | null;
  banRate: number | null;
}

/** 챔피언 이미지 데이터 (테이블 표시용) */
export interface ChampionImageData {
  name: string;
  url: string;
  championName?: string;
  championId?: number;
  tier?: string | null;
  position?: string | null;
  positionDetails?: Record<string, PositionDetail>;
  pickCount?: number | null;
  winCount?: number | null;
  pickRate?: number | null;
  winRate?: number | null;
  banRate?: number | null;
}

/** 챔피언 이미지 API 응답 */
export interface ChampionImageApiResponse {
  championImageUrls: ChampionImageData[];
}

/** 챔피언 티어 API 응답 */
export interface ChampionTierApiResponse {
  ok: boolean;
  data: Array<{
    championId: number;
    tier: string;
    position: string;
    score: number;
    pickCount: number;
    winCount: number;
    pickRate: number;
    winRate: number;
    banRate: number;
    items: number[];
    primaryRunes: number[];
    subRunes: number[];
  }>;
}
