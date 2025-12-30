/* 미니맵_이미지
https://ddragon.leagueoflegends.com/cdn/14.18.1/img/map/map11.png
*/
export const getMinimap_Image = (version: string, mapNumber: number): string => {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/map/map${mapNumber}.png`;
};
