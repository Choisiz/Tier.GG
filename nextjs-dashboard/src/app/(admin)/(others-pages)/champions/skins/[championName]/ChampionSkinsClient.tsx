'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

// 타입 정의 (API 응답과 동일)
interface ChampionSkinData {
  id: string;
  num: number;
  name: string;
  splashUrl: string;
  loadingUrl: string;
  chromas?: boolean;
}

interface ChampionSkinsResponse {
  championId: string;
  championName: string;
  skins: ChampionSkinData[];
}

interface ChampionSkinsClientProps {
  championName: string;
  version?: string;
  language?: string;
}

// 로딩 스켈레톤 컴포넌트
function SkinLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 헤더 스켈레톤 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded w-64 animate-pulse"></div>
        </div>
      </div>

      {/* 메인 콘텐츠 스켈레톤 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-8">
          <div className="h-10 bg-gray-300 dark:bg-gray-600 rounded w-48 mx-auto mb-4 animate-pulse"></div>
          <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-32 mx-auto animate-pulse"></div>
        </div>

        {/* 큰 이미지 스켈레톤 */}
        <div className="h-96 bg-gray-300 dark:bg-gray-600 rounded-xl mb-8 animate-pulse"></div>

        {/* 썸네일 그리드 스켈레톤 */}
        <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="aspect-[3/4] bg-gray-300 dark:bg-gray-600 rounded-lg animate-pulse"></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 에러 컴포넌트
function SkinError({ error, onRetry, championName }: { error: string; onRetry: () => void; championName: string }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center max-w-md">
        <div className="mb-6">
          <svg 
            className="mx-auto h-16 w-16 text-red-500" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-4">
          {championName} 스킨을 불러올 수 없습니다
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          {error}
        </p>
        <div className="space-y-3">
          <button
            onClick={onRetry}
            className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            다시 시도
          </button>
          <Link
            href="/basic-tables"
            className="block w-full px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            챔피언 목록으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}

// 메인 스킨 클라이언트 컴포넌트
export default function ChampionSkinsClient({ championName, version, language = 'ko_KR' }: ChampionSkinsClientProps) {
  const [data, setData] = useState<ChampionSkinsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSkin, setSelectedSkin] = useState<number>(0);

  const fetchSkins = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams({
        championName,
        ...(version && { version }),
        language
      });

      const response = await fetch(`/api/champion_skins?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: 스킨 데이터를 불러오는데 실패했습니다.`);
      }

      const result: ChampionSkinsResponse = await response.json();
      setData(result);
      setSelectedSkin(0); // 첫 번째 스킨으로 초기화
      
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (championName) {
      fetchSkins();
    }
  }, [championName, version, language]);

  // 키보드 네비게이션
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!data?.skins.length) return;
      
      if (e.key === 'ArrowLeft') {
        setSelectedSkin(prev => prev > 0 ? prev - 1 : data.skins.length - 1);
      } else if (e.key === 'ArrowRight') {
        setSelectedSkin(prev => prev < data.skins.length - 1 ? prev + 1 : 0);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [data?.skins.length]);

  if (loading) {
    return <SkinLoadingSkeleton />;
  }

  if (error) {
    return <SkinError error={error} onRetry={fetchSkins} championName={championName} />;
  }

  if (!data || !data.skins.length) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-600 dark:text-gray-400 mb-4">
            {championName}의 스킨 데이터가 없습니다
          </h2>
          <Link
            href="/basic-tables"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            챔피언 목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 브레드크럼 네비게이션 */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <nav className="flex" aria-label="Breadcrumb">
              <ol className="flex items-center space-x-4">
                <li>
                  <Link 
                    href="/basic-tables"
                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors text-sm font-medium"
                  >
                    챔피언 목록
                  </Link>
                </li>
                <li>
                  <div className="flex items-center">
                    <svg className="flex-shrink-0 h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    <span className="ml-4 text-sm font-medium text-gray-700 dark:text-gray-300">
                      {data.championName} 스킨
                    </span>
                  </div>
                </li>
              </ol>
            </nav>

            {/* 뒤로가기 버튼 */}
            <Link
              href="/basic-tables"
              className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              목록으로 돌아가기
            </Link>
          </div>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          
          {/* 챔피언 정보 헤더 */}
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
              {data.championName}
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              총 {data.skins.length}개의 스킨
            </p>
          </div>

          {/* 선택된 스킨의 큰 이미지 */}
          <div className="relative h-[700px] w-full rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-br from-blue-500 to-purple-600">
            <Image
              src={data.skins[selectedSkin]?.splashUrl || ''}
              alt={data.skins[selectedSkin]?.name || ''}
              fill
              className="object-cover object-center"
              priority
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 70vw"
            />
            
            {/* 스킨 이름 오버레이 */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-8">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-white text-3xl font-bold mb-2">
                    {data.skins[selectedSkin]?.name}
                  </h2>
                  <div className="flex items-center space-x-4 text-white/80">
                    <span className="text-lg">스킨 #{data.skins[selectedSkin]?.num}</span>
                    <span className="text-sm">
                      {selectedSkin + 1} / {data.skins.length}
                    </span>
                  </div>
                </div>
                {data.skins[selectedSkin]?.chromas && (
                  <div className="bg-purple-600/90 backdrop-blur-sm text-white px-4 py-2 rounded-full text-sm font-medium">
                    ✨ 크로마 Available
                  </div>
                )}
              </div>
            </div>

            {/* 네비게이션 버튼 */}
            {data.skins.length > 1 && (
              <>
                <button
                  onClick={() => setSelectedSkin(prev => prev > 0 ? prev - 1 : data.skins.length - 1)}
                  className="absolute left-6 top-1/2 transform -translate-y-1/2 bg-black/30 hover:bg-black/50 backdrop-blur-sm text-white p-3 rounded-full transition-all duration-200 hover:scale-110"
                  aria-label="이전 스킨"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedSkin(prev => prev < data.skins.length - 1 ? prev + 1 : 0)}
                  className="absolute right-6 top-1/2 transform -translate-y-1/2 bg-black/30 hover:bg-black/50 backdrop-blur-sm text-white p-3 rounded-full transition-all duration-200 hover:scale-110"
                  aria-label="다음 스킨"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* 스킨 썸네일 그리드 */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg">
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-6 text-center">
              모든 스킨 ({data.skins.length}개)
            </h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-4">
              {data.skins.map((skin, index) => (
                <button
                  key={skin.id}
                  onClick={() => setSelectedSkin(index)}
                  className={`relative group rounded-xl overflow-hidden transition-all duration-300 ${
                    selectedSkin === index 
                      ? 'ring-4 ring-blue-500 scale-105 shadow-xl' 
                      : 'hover:scale-105 hover:shadow-lg'
                  }`}
                >
                  <div className="aspect-[2/4] relative">
                    <Image
                      src={skin.loadingUrl}
                      alt={skin.name}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 33vw, (max-width: 1200px) 16vw, 10vw"
                    />
                    
                    {/* 호버 오버레이 */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200" />
                    
                    {/* 스킨 번호 */}
                    <div className="absolute top-2 left-2 bg-black/70 backdrop-blur-sm text-white text-xs px-2 py-1 rounded-full font-medium">
                      #{skin.num}
                    </div>
                    
                    {/* 크로마 뱃지 */}
                    {skin.chromas && (
                      <div className="absolute top-2 right-2 bg-purple-600 text-white text-xs px-2 py-1 rounded-full font-medium">
                        C
                      </div>
                    )}

                    {/* 선택된 스킨 표시 */}
                    {selectedSkin === index && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="bg-blue-600 text-white p-2 rounded-full">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  {/* 스킨 이름 */}
                  <div className="p-3 bg-white dark:bg-gray-700">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate" title={skin.name}>
                      {skin.name}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 스킨 정보 카드 */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg">
            <h3 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6 text-center">
              현재 스킨 정보
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              <div className="text-center p-6 bg-gray-50 dark:bg-gray-700 rounded-xl">
                <div className="text-lg font-bold text-gray-900 dark:text-white mb-2 h-14 flex items-center justify-center">
                  {data.skins[selectedSkin]?.name}
                </div>
                <p className="text-gray-600 dark:text-gray-400 font-medium">스킨 이름</p>
              </div>
              
              <div className="text-center p-6 bg-gray-50 dark:bg-gray-700 rounded-xl">
                <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
                  #{data.skins[selectedSkin]?.num}
                </div>
                <p className="text-gray-600 dark:text-gray-400 font-medium">스킨 번호</p>
              </div>
              
              <div className="text-center p-6 bg-gray-50 dark:bg-gray-700 rounded-xl">
                <div className="text-3xl font-bold text-purple-600 dark:text-purple-400 mb-2">
                  {data.skins[selectedSkin]?.chromas ? '✅' : '❌'}
                </div>
                <p className="text-gray-600 dark:text-gray-400 font-medium">
                  크로마 {data.skins[selectedSkin]?.chromas ? '있음' : '없음'}
                </p>
              </div>
              
           
            </div>
          </div>
        </div>
      </main>

    </div>
  );
}