import { DDRAGON_BASE_URL } from "./constants";

/** 스퀘어 아이콘: /cdn/{version}/img/champion/{image.full} */
export function championIconUrl(version: string, imageFull: string): string {
  return `${DDRAGON_BASE_URL}/cdn/${version}/img/champion/${imageFull}`;
}

/** 스플래시: /cdn/img/champion/splash/{id}_{num}.jpg (버전 없음) */
export function championSplashUrl(championId: string, skinNum: number): string {
  return `${DDRAGON_BASE_URL}/cdn/img/champion/splash/${championId}_${skinNum}.jpg`;
}

/** 로딩 화면: /cdn/img/champion/loading/{id}_{num}.jpg (버전 없음) */
export function championLoadingUrl(championId: string, skinNum: number): string {
  return `${DDRAGON_BASE_URL}/cdn/img/champion/loading/${championId}_${skinNum}.jpg`;
}

/**
 * 챔피언 스킬(Q/W/E/R) 아이콘: /cdn/{version}/img/spell/{image.full}
 * 소환사 주문과 같은 img/spell/ 폴더를 쓰지만 별개 데이터다.
 */
export function skillIconUrl(version: string, imageFull: string): string {
  return `${DDRAGON_BASE_URL}/cdn/${version}/img/spell/${imageFull}`;
}

/** 패시브 아이콘: /cdn/{version}/img/passive/{passive.image.full} */
export function passiveIconUrl(version: string, imageFull: string): string {
  return `${DDRAGON_BASE_URL}/cdn/${version}/img/passive/${imageFull}`;
}
