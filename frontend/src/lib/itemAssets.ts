//아이템 정보
export const getItems_Info= (version: string, language:string): string =>{
    return `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/item.json`;
  }

//아이템 이미지
export const getItem_Image= (version: string, name:number): string =>{
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${name}.png`;
  }