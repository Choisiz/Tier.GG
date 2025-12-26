// 최신 버전 URL
export const getVersions_Url = (): string => {
  return "https://ddragon.leagueoflegends.com/api/versions.json";
};

// 챔피언 데이터 URL (간략)
export const getChampionData_Url = (version: string, language: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/champion.json`;
};

// 챔피언 데이터 URL (상세)
export const getChampionData_Detail_Url = (
  version: string,
  language: string,
  name: string
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/champion/${name}.json`;
};

// 챔피언 이미지_스퀘어
export const getChampionImageUrl = (
  version: string,
  championName: string
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
};

// 챔피언 이미지_스킨
export const getChampionImageUrl_Skin = (
  version: string,
  championName: string,
  number: number
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/loading/${championName}_${number}.jpg`;
};

// 챔피언 이미지_스킨_full
export const getChampionImageUrl_Skin_Full = (
  championName: string,
  number: number
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championName}_${number}.jpg`;
};

// 챔피언 이미지_스킬
export const getChampionImageUrl_Skill = (
  version: string,
  name: string
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${name}.png`;
};

// 챔피언 이미지_패시브
export const getChampionImageUrl_Passive = (
  version: string,
  name: string
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/passive/${name}.png`;
};
