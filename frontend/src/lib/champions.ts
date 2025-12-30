/* 패치버전_리스트 */
export const getVersions_Url = (): string => {
  return "https://ddragon.leagueoflegends.com/api/versions.json";
};

/* 챔피언_데이터_(간략)
ex) https://ddragon.leagueoflegends.com/cdn/15.24.1/data/ko_KR/champion.json
*/
export const getChampion_Data = (version: string, language: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/champion.json`;
};

/* 챔피언_데이터_(상세)
ex) https://ddragon.leagueoflegends.com/cdn/15.13.1/data/ko_KR/champion/Aatrox.json
*/
export const getChampion_Data_Detail = (
  version: string,
  language: string,
  name: string
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/champion/${name}.json`;
};

/* 챔피언_이미지_스퀘어 
ex) https://ddragon.leagueoflegends.com/cdn/14.18.1/img/champion/Aatrox.png
*/
export const getChampion_Image_Square = (
  version: string,
  championName: string
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
};

/* 챔피언_이미지_로딩
ex) https://ddragon.leagueoflegends.com/cdn/img/champion/loading/Aatrox_0.jpg
*/
export const getChampion_Image_Loading = (
  version: string,
  championName: string,
  number: number
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championName}_${number}.jpg`;
};

/* 챔피언_이미지_full */
export const getChampion_Image_Full = (
  championName: string,
  number: number
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championName}_${number}.jpg`;
};

/* 챔피언_이미지_스킬
ex) https://ddragon.leagueoflegends.com/cdn/14.18.1/img/spell/AatroxQ.png
*/
export const getChampion_Image_Skill = (
  version: string,
  name: string
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${name}.png`;
};

/* 챔피언_이미지_패시브
ex) https://ddragon.leagueoflegends.com/cdn/14.18.1/img/passive/Aatrox_Passive.png
*/
export const getChampion_Image_Passive = (
  version: string,
  name: string
): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/passive/${name}.png`;
};

/* DDragon 공용 이미지 헬퍼 (파일명 그대로 사용)
ex) getDdragonImageByFile("15.11.1", "spell", "AatroxQ.png")
*/
export const getDdragonImageByFile = (
  version: string,
  category: "champion" | "spell" | "passive",
  filename: string
): string => {
  const pathMap = {
    champion: "champion",
    spell: "spell",
    passive: "passive",
  };
  const dir = pathMap[category];
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/${dir}/${filename}`;
};
