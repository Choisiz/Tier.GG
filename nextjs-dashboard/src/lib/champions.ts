import axios from 'axios'
import {cache} from 'react'

// 최신 버전 가져오기 (React cache로 성능 최적화)
export const getLatestVersion = cache(async (): Promise<string> => {
    try {
      const response = await axios.get('https://ddragon.leagueoflegends.com/api/versions.json');
      return response.data[0]; // 첫 번째 항목이 최신 버전
    } catch (error) {
      console.error('버전 정보를 가져오는 중 오류 발생:', error);
      return '15.11.1'; // 기본 버전
    }
  });

// 챔피언 데이터 가져오기
export const getChampionData = cache(
    async (version: string, language:string) => {
      try {
        const response = await axios.get(
          `https://ddragon.leagueoflegends.com/cdn/${version}/data/${language}/champion.json`
        );
        return response.data;
      } catch (error) {
        console.error('챔피언 데이터를 가져오는 중 오류 발생:', error);
        throw new Error('챔피언 데이터를 불러올 수 없습니다.');
      }
    }
  );

// 챔피언 이미지 URL
export const getChampionImageUrl= (version: string, championName: string): string =>{
    return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championName}.png`;
  }