// app/(admin)/(others-pages)/champions/info/[championName]/page.tsx
'use client';

import { useState, useEffect } from 'react';
import {  useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

const ChevronLeft = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);


interface ChampionPositionInsight {
  position: string;
  tier: string | null;
  pickCount: number;
  winCount: number;
  pickRate: number;
  winRate: number;
  banRate: number;
  items: Array<{ id: number; image: string }>;
  runes: {
    primary: Array<{ id: number; image: string | null }>;
    sub: Array<{ id: number; image: string | null }>;
  };
}

interface ChampionData {
  id: string;
  key: string;
  name: string;
  title: string;
  image: {
    full: string;
    sprite: string;
    group: string;
    x: number;
    y: number;
    w: number;
    h: number;
  };
  skins: Array<{
    id: string;
    num: number;
    name: string;
    chromas: boolean;
  }>;
  lore: string;
  blurb: string;
  allytips: string[];
  enemytips: string[];
  tags: string[];
  partype: string;
  info: {
    attack: number;
    defense: number;
    magic: number;
    difficulty: number;
  };
  stats: {
    hp: number;
    hpperlevel: number;
    mp: number;
    mpperlevel: number;
    movespeed: number;
    armor: number;
    armorperlevel: number;
    spellblock: number;
    spellblockperlevel: number;
    attackrange: number;
    hpregen: number;
    hpregenperlevel: number;
    mpregen: number;
    mpregenperlevel: number;
    crit: number;
    critperlevel: number;
    attackdamage: number;
    attackdamageperlevel: number;
    attackspeedperlevel: number;
    attackspeed: number;
  };
  spells: Array<{
    id: string;
    name: string;
    description: string;
    tooltip: string;
    leveltip: {
      label: string[];
      effect: string[];
    };
    maxrank: number;
    cooldown: number[];
    cooldownBurn: string;
    cost: number[];
    costBurn: string;
    range: number[];
    rangeBurn: string;
    image: {
      full: string;
      sprite: string;
      group: string;
      x: number;
      y: number;
      w: number;
      h: number;
    };
  }>;
  passive: {
    name: string;
    description: string;
    image: {
      full: string;
      sprite: string;
      group: string;
      x: number;
      y: number;
      w: number;
      h: number;
    };
  };
}

type ActiveSpell = ChampionData["spells"][number];
type PassiveSkill = ChampionData["passive"];

const POSITION_ICON_FILES: Record<string, string> = {
  TOP: "Position_Diamond-Top.png",
  JUNGLE: "Position_Diamond-Jungle.png",
  MIDDLE: "Position_Diamond-Mid.png",
  MID: "Position_Diamond-Mid.png",
  BOTTOM: "Position_Diamond-Bot.png",
  BOT: "Position_Diamond-Bot.png",
  ADC: "Position_Diamond-Bot.png",
  UTILITY: "Position_Diamond-Support.png",
  SUPPORT: "Position_Diamond-Support.png",
};

const POSITION_LABELS: Record<string, string> = {
  TOP: "TOP",
  JUNGLE: "JUNGLE",
  MIDDLE: "MIDDLE",
  MID: "MIDDLE",
  BOTTOM: "BOTTOM",
  BOT: "BOTTOM",
  ADC: "BOTTOM",
  UTILITY: "SUPPORT",
  SUPPORT: "SUPPORT",
};

const getPositionIcon = (position?: string | null) => {
  const key = position?.toUpperCase();
  const file =
    POSITION_ICON_FILES[key ?? ""] ?? "Position_Diamond-Mid.png";
  return `/images/position/${file}`;
};

const getPositionLabel = (position?: string | null) => {
  if (!position) return "전체";
  const key = position.toUpperCase();
  return POSITION_LABELS[key] ?? key;
};

function StatBar({ value, max = 10 }: { value: number; max?: number }) {
  const percentage = (value / max) * 100;
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
      <div 
        className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

function SkillIcon({ skill, skillKey, version, isPassive = false }: { 
  skill: ActiveSpell | PassiveSkill; 
  skillKey: string; 
  version: string;
  isPassive?: boolean;
}) {
  const imageUrl = isPassive 
    ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/passive/${skill.image.full}`
    : `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${skill.image.full}`;

  return (
    <div className="group relative">
      <div className=" w-12 h-12 rounded-lg overflow-hidden border-2 border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 hover:border-blue-500 transition-colors cursor-pointer">
        <Image
          src={imageUrl}
          alt={skill.name}
          width={48}
          height={48}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-600 text-white text-xs font-bold rounded-full flex items-center justify-center">
        {skillKey}
      </div>
      
      {/* 툴팁 */}
      <div className="z-50 absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-10 w-64">
        <div className="font-bold mb-1">{skill.name}</div>
        <div className="text-gray-300 leading-relaxed">
          {skill.description ? skill.description.replace(/<[^>]*>/g, '') : '스킬 설명이 없습니다.'}
        </div>
        {!isPassive &&
          "cooldownBurn" in skill &&
          skill.cooldownBurn && (
          <div className="mt-2 text-xs text-gray-400">
            쿨다운: {skill.cooldownBurn}초 | 소모: {"costBurn" in skill ? skill.costBurn : "-"} | 사거리: {"rangeBurn" in skill ? skill.rangeBurn : "-"}
          </div>
        )}
        {/* 툴팁 화살표 */}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
      </div>
    </div>
  );
}

export default function ChampionDetailPage() {
  const params = useParams();
  const championName = params.championName as string;
  const [championData, setChampionData] = useState<ChampionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [positionData, setPositionData] = useState<ChampionPositionInsight[]>([]);
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionError, setPositionError] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null);
  const version = "15.11.1";

  useEffect(() => {
    async function fetchChampionData() {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/champion_info?version=${version}&lang=ko_KR&name=${championName}`);
        
        if (!response.ok) {
          throw new Error(`API 호출 실패: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.data || !data.data[championName]) {
          throw new Error('챔피언 데이터를 찾을 수 없습니다');
        }
        
        setChampionData(data.data[championName]);
      } catch (err) {
        console.error('챔피언 데이터 로딩 실패:', err);
        setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다');
      } finally {
        setLoading(false);
      }
    }

    if (championName) {
      fetchChampionData();
    }
  }, [championName]);

  useEffect(() => {
    if (!championData) {
      return;
    }
    const champId = Number(championData.key);
    if (!champId) {
      return;
    }
    const controller = new AbortController();

    async function fetchPositionData() {
      try {
        setPositionLoading(true);
        setPositionError(null);
        const response = await fetch(
          `/api/champion_item?championId=${champId}`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`포지션 데이터 호출 실패: ${response.status}`);
        }
        const payload = await response.json();
        if (!payload?.ok) {
          throw new Error(payload?.error || "포지션 데이터를 찾을 수 없습니다");
        }
        const positions: ChampionPositionInsight[] = payload.positions || [];
        setPositionData(positions);
        setSelectedPosition(positions[0]?.position ?? null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.error("포지션 데이터 로딩 실패:", err);
        setPositionError(
          err instanceof Error
            ? err.message
            : "포지션 데이터를 불러오는 중 문제가 발생했습니다"
        );
        setPositionData([]);
        setSelectedPosition(null);
      } finally {
        setPositionLoading(false);
      }
    }

    fetchPositionData();

    return () => controller.abort();
  }, [championData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">챔피언 정보를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (error || !championData) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">😢</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">챔피언 정보를 불러올 수 없습니다</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
          <Link
            href="/champions"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 mr-2" />
            챔피언 목록으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  
  const championImageUrl = `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championData.image.full}`;
  const formatPercent = (value?: number | null) =>
    typeof value === "number" ? `${value.toFixed(2)}%` : "-";
  const formatNumber = (value?: number | null) =>
    typeof value === "number" ? value.toLocaleString() : "-";
  const activePosition =
    positionData.find((pos) => pos.position === selectedPosition) ??
    positionData[0] ??
    null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* 헤더 */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-md border-b border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Link 
            href="/basic-tables"
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            챔피언 리스트로 이동
          </h1>
        </div>
      </header>

      <section className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">
              포지션별 빌드 정보
            </h2>
            {positionLoading && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <span className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                불러오는 중...
              </div>
            )}
          </div>
          {positionError && (
            <p className="text-sm text-red-500 dark:text-red-400 mb-4">
              {positionError}
            </p>
          )}
          {!positionLoading && !positionError && positionData.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              아직 수집된 포지션 통계가 없습니다.
            </p>
          )}
          {!positionLoading && positionData.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2 mb-6">
                {positionData.map((pos) => {
                  const label = getPositionLabel(pos.position);
                  const icon = getPositionIcon(pos.position, version);
                  const isActive = selectedPosition
                    ? selectedPosition === pos.position
                    : positionData[0]?.position === pos.position;
                  return (
                    <button
                      key={pos.position}
                      type="button"
                      onClick={() => setSelectedPosition(pos.position)}
                      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-gray-200 text-gray-700 dark:bg-white/10 dark:text-gray-300"
                      }`}
                    >
                      <Image
                        src={icon}
                        alt={label}
                        width={20}
                        height={20}
                        className="rounded-full"
                      />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              {activePosition && (
                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                      포지션 통계
                    </h3>
                    <dl className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                      <div className="flex justify-between">
                        <dt>포지션</dt>
                        <dd>{getPositionLabel(activePosition.position)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>티어</dt>
                        <dd>{activePosition.tier ?? "정보 없음"}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>승률</dt>
                        <dd>{formatPercent(activePosition.winRate)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>픽률</dt>
                        <dd>{formatPercent(activePosition.pickRate)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>밴률</dt>
                        <dd>{formatPercent(activePosition.banRate)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>승수 / 픽수</dt>
                        <dd>
                          {formatNumber(activePosition.winCount)} /{" "}
                          {formatNumber(activePosition.pickCount)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                      핵심 아이템
                    </h3>
                    {activePosition.items.length ? (
                      <div className="flex flex-wrap gap-3">
                        {activePosition.items.map((item, idx) => (
                          <div
                            key={`${item.id}-${idx}`}
                            className="flex flex-col items-center text-xs text-gray-600 dark:text-gray-300"
                          >
                            <div className="w-12 h-12 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                              <Image
                                src={item.image}
                                alt={`item-${item.id}`}
                                width={48}
                                height={48}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <span className="mt-1 font-medium">
                              #{idx + 1}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        아이템 데이터가 없습니다.
                      </p>
                    )}
                  </div>
                  <div className="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
                      추천 룬
                    </h3>
                    <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
                      <div>
                        <p className="font-semibold mb-2">주요 룬</p>
                        <div className="flex flex-wrap gap-2">
                          {activePosition.runes.primary.length ? (
                            activePosition.runes.primary.map((rune) =>
                              rune.image ? (
                                <Image
                                  key={`primary-${rune.id}`}
                                  src={rune.image}
                                  alt={`rune-${rune.id}`}
                                  width={40}
                                  height={40}
                                  className="w-10 h-10 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                                />
                              ) : (
                                <span
                                  key={`primary-${rune.id}`}
                                  className="px-3 py-1 rounded-full bg-gray-200 dark:bg-gray-700"
                                >
                                  {rune.id}
                                </span>
                              )
                            )
                          ) : (
                            <span className="text-xs text-gray-500">
                              정보 없음
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <p className="font-semibold mb-2">보조 룬</p>
                        <div className="flex flex-wrap gap-2">
                          {activePosition.runes.sub.length ? (
                            activePosition.runes.sub.map((rune) =>
                              rune.image ? (
                                <Image
                                  key={`sub-${rune.id}`}
                                  src={rune.image}
                                  alt={`rune-${rune.id}`}
                                  width={40}
                                  height={40}
                                  className="w-10 h-10 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                                />
                              ) : (
                                <span
                                  key={`sub-${rune.id}`}
                                  className="px-3 py-1 rounded-full bg-gray-200 dark:bg-gray-700"
                                >
                                  {rune.id}
                                </span>
                              )
                            )
                          ) : (
                            <span className="text-xs text-gray-500">
                              정보 없음
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <div className="container mx-auto px-4 py-8">
        {/* 메인 정보 섹션 */}
        <div className="grid lg:grid-cols-3 gap-8 mb-4">
          {/* 챔피언 이미지 & 기본 정보 */}
          <div className="lg:col-span-1">
            
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
              <div className="flex items-center gap-6 mb-4">
                <h2 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">{championData.name}</h2>
                <p className="text-gray-600 dark:text-gray-300 text-lg">{version} 패치</p>
              </div>
              <div className="flex items-center gap-6 mb-4">
                <div className="flex items-center gap-6 mb-4">
                  {/* 챔피언 이미지 */}
                  <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-gray-200 dark:border-gray-600 flex-shrink-0">
                    <Image
                      src={championImageUrl}
                      alt={championData.name}
                      width={192}
                      height={192}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {/* 스킬 이미지 */}
                  <div className="flex gap-3 flex-wrap">
                  <SkillIcon skill={championData.passive} skillKey="P" version={version} isPassive={true} />
                  {championData.spells.map((spell, index) => (
                    <SkillIcon 
                      key={spell.id} 
                      skill={spell} 
                      skillKey={['Q', 'W', 'E', 'R'][index]} 
                      version={version}
                    />
                  ))}
                  </div>           
                </div>
              </div>
                <div className="flex items-center gap-6 mb-4">
                <h2 className="text-3xl font-bold mb-2 text-gray-900 dark:text-white">티어리스트</h2>
                <p className="text-gray-600 dark:text-gray-300 text-lg">{version} 패치</p>
              </div>  
            </div>  
          </div>

          {/* 능력치 & 스탯 */}
          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
              <h3 className="text-xl font-bold mb-6 flex items-center gap-2 text-gray-900 dark:text-white">          
                능력치
              </h3>
              
              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      
                        공격력
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">{championData.info.attack}/10</span>
                    </div>
                    <StatBar value={championData.info.attack} />
                  </div>
                  
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">                      
                        방어력
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">{championData.info.defense}/10</span>
                    </div>
                    <StatBar value={championData.info.defense} />
                  </div>                  
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">                  
                        마법력
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">{championData.info.magic}/10</span>
                    </div>
                    <StatBar value={championData.info.magic} />
                  </div>
                  
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="flex items-center gap-2 text-gray-700 dark:text-gray-300">                      
                        난이도
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">{championData.info.difficulty}/10</span>
                    </div>
                    <StatBar value={championData.info.difficulty} />
                  </div>
                </div>
                
                <div className="space-y-6">                
                  <div className='flex justify-between'>
                     {/* 기본 스탯 */}
                    <div>
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">기본 스탯 (레벨 1)</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">체력:</span>
                        <span className="text-green-600 dark:text-green-400 font-medium">{championData.stats.hp}</span>
                        </div>
                        <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">마나:</span>
                        <span className="text-blue-600 dark:text-blue-400 font-medium">{championData.stats.mp}</span>
                        </div>
                        <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">공격력:</span>
                        <span className="text-red-600 dark:text-red-400 font-medium">{championData.stats.attackdamage}</span>
                        </div>
                        <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">방어력:</span>
                        <span className="text-yellow-600 dark:text-yellow-400 font-medium">{championData.stats.armor}</span>
                        </div>
                        <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">마법 저항력:</span>
                        <span className="text-purple-600 dark:text-purple-400 font-medium">{championData.stats.spellblock}</span>
                        </div>
                        <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">이동속도:</span>
                        <span className="text-cyan-600 dark:text-cyan-400 font-medium">{championData.stats.movespeed}</span>
                        </div>
                        <div className="flex">
                          <span className="text-gray-500 dark:text-gray-400">공격 속도:</span>
                          <span className="text-orange-600 dark:text-orange-400 font-medium">{championData.stats.attackspeed}</span>
                        </div>
                        <div className='flex'>
                          <span className="text-gray-500 dark:text-gray-400">사거리:</span>
                          <span className="ml-2 text-green-600 dark:text-green-400 font-medium">{championData.stats.attackrange}</span>
                        </div>
                      </div>
                    </div>
                    {/* 성장 스탯 */}
                    <div>
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">성장 스탯 (레벨당 증가)</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">체력 성장:</span>
                        <span className="text-green-500 dark:text-green-300 font-medium">+{championData.stats.hpperlevel}</span>
                      </div>
                      <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">마나 성장:</span>
                        <span className="text-blue-500 dark:text-blue-300 font-medium">+{championData.stats.mpperlevel}</span>
                      </div>
                      <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">공격력 성장:</span>
                        <span className="text-red-500 dark:text-red-300 font-medium">+{championData.stats.attackdamageperlevel}</span>
                      </div>
                      <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">방어력 성장:</span>
                        <span className="text-yellow-500 dark:text-yellow-300 font-medium">+{championData.stats.armorperlevel}</span>
                      </div>
                      <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">마저 성장:</span>
                        <span className="text-purple-500 dark:text-purple-300 font-medium">+{championData.stats.spellblockperlevel}</span>
                      </div>
                      <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">공속 성장:</span>
                        <span className="text-orange-500 dark:text-orange-300 font-medium">+{championData.stats.attackspeedperlevel}%</span>
                      </div>
                    </div>
                    </div>
                    {/* 재생스탯 */}
                    <div>
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">재생 스탯</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">체력 재생:</span>
                        <span className="text-green-600 dark:text-green-400 font-medium">{championData.stats.hpregen} (+{championData.stats.hpregenperlevel})</span>
                      </div>
                      <div className="flex">
                        <span className="text-gray-500 dark:text-gray-400">마나 재생:</span>
                        <span className="text-blue-600 dark:text-blue-400 font-medium">{championData.stats.mpregen} (+{championData.stats.mpregenperlevel})</span>
                      </div>
                    </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

        {/* 추가 정보 섹션 - 아이템, 팁 등을 위한 공간 */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* 배경 이야기 */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">배경 이야기</h3>
            <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">
              {championData.lore}
            </p>
          </div>

          {/* 스킨 정보 */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white">스킨</h3>
              <span className="text-sm text-gray-500 dark:text-gray-400">총 {championData.skins.length}개</span>
            </div>
            
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {championData.skins.map((skin) => (
                <div key={skin.id} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{skin.name}</span>
                  {skin.chromas && (
                    <span className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 px-2 py-1 rounded">
                      크로마
                    </span>
                  )}
                </div>
              ))}
            </div>
            
            <Link
              href={`/champions/skins/${championData.id}`}
              className="mt-4 w-full inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors duration-200"
            >
              스킨 갤러리 보기
            </Link>
          </div>
        </div>

        {/* 향후 아이템 정보나 추가 컨텐츠를 위한 공간 */}
        <div className="mt-8">
          {/* 여기에 추후 아이템 정보, 챔피언 팁, 카운터 정보 등을 추가할 수 있습니다 */}
        </div>
      </div>
    </div>
  );
}