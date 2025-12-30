'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { ChampionSkinsResponse } from "@/types/skin";

interface ChampionSkinsClientProps {
  initialData: ChampionSkinsResponse;
}

export default function ChampionSkinsClient({ initialData }: ChampionSkinsClientProps) {
  const [selectedSkin, setSelectedSkin] = useState<number>(0);

  // 키보드 네비게이션
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (!initialData?.skins.length) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setSelectedSkin(prev => prev > 0 ? prev - 1 : initialData.skins.length - 1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setSelectedSkin(prev => prev < initialData.skins.length - 1 ? prev + 1 : 0);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [initialData?.skins.length]);

  if (!initialData || !initialData.skins.length) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-600 dark:text-gray-400 mb-4">
            스킨 데이터가 없습니다
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

  const currentSkin = initialData.skins[selectedSkin];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/basic-tables"
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            챔피언 리스트로 이동
          </h1>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* 왼쪽: 선택된 스킨 이미지 */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">챔피언: {initialData.championName}</h2>
                <div className="flex items-center gap-2">
                  {currentSkin?.chromas && (
                    <span className="bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-3 py-1 rounded-full text-sm font-medium">
                      크로마
                    </span>
                  )}
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedSkin + 1} / {initialData.skins.length}
                  </span>
                </div>
              </div>

              {/* 스킨 이미지 */}
              <div className="relative aspect-video rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-700">
                <Image
                  src={currentSkin?.splashUrl || ''}
                  alt={currentSkin?.name || ''}
                  fill
                  className="object-cover object-top"
                  priority
                  sizes="(max-width: 768px) 100vw, 66vw"
                />

                {/* 스킨 이름 오버레이 */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                  <h3 className="text-white text-2xl font-bold">{currentSkin?.name}</h3>
                </div>

                {/* 네비게이션 버튼 */}
                {initialData.skins.length > 1 && (
                  <>
                    <button
                      onClick={() => setSelectedSkin(prev => prev > 0 ? prev - 1 : initialData.skins.length - 1)}
                      className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 backdrop-blur-sm text-white p-2 rounded-full transition-all"
                      aria-label="이전 스킨"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setSelectedSkin(prev => prev < initialData.skins.length - 1 ? prev + 1 : 0)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 backdrop-blur-sm text-white p-2 rounded-full transition-all"
                      aria-label="다음 스킨"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* 오른쪽: 스킨 리스트 */}
          <div className="lg:col-span-1">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                스킨 목록
                </h2>
              </div>

              <div className="grid grid-cols-4 gap-2 max-h-[510px] overflow-y-auto pr-2">
                {initialData.skins.map((skin, index) => (
                  <button
                    key={skin.id}
                    onClick={() => setSelectedSkin(index)}
                    className={`flex flex-col p-2 rounded-xl transition-all ${
                      selectedSkin === index
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500'
                        : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    {/* 스킨 썸네일 */}
                    <div className="relative w-full aspect-[3/4] rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-600">
                      <Image
                        src={skin.loadingUrl}
                        alt={skin.name}
                        fill
                        className="object-cover object-top"
                        sizes="(max-width: 768px) 50vw, 150px"
                      />
                      {/* 선택 표시 */}
                      {selectedSkin === index && (
                        <div className="absolute top-1 right-1 bg-blue-500 rounded-full p-0.5">
                          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                      {/* 크로마 뱃지 */}
                      {skin.chromas && (
                        <div className="absolute bottom-1 left-1">
                          <span className="text-xs bg-purple-500 text-white px-1.5 py-0.5 rounded">
                            크로마
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 스킨 이름 */}
                    <p className={`mt-2 text-sm font-medium text-center truncate w-full ${
                      selectedSkin === index
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-gray-900 dark:text-white'
                    }`}>
                      {skin.name}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
