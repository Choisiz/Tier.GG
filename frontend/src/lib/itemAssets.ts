/* 아이템_정보
ex) https://ddragon.leagueoflegends.com/cdn/14.18.1/data/ko_KR/item.json
*/
export const getItems_Info = (version: string, language: string): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/item.json`;
};

/* 아이템_이미지
ex) https://ddragon.leagueoflegends.com/cdn/14.18.1/img/item/3031.png
*/
export const getItem_Image = (version: string, itemId: number): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
};
