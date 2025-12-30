'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "../ui/table";
import Image from "next/image";
import Link from "next/link";
import type { ChampionImageData } from "@/types/champion";

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

export default function BasicTableOne({
  champions = [],
}: {
  champions?: ChampionImageData[];
}) {
  const tierColor = (tier?: string | null) => {
    switch (tier) {
      case "OP":
        return "bg-purple-600 text-white";
      case "1tier":
        return "bg-emerald-500 text-white";
      case "2tier":
        return "bg-blue-500 text-white";
      case "3tier":
        return "bg-amber-500 text-white";
      case "4tier":
        return "bg-gray-400 text-white";
      default:
        return "bg-gray-200 text-gray-700";
    }
  };

  const tierLabel = (tier?: string | null) => tier ?? "정보 없음";
  const formatPercent = (value?: number | null) =>
    typeof value === "number" ? `${value.toFixed(2)}%` : "-";

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/[0.05] dark:bg-white/[0.03]">
      {/* 총 챔피언 수 표시 */}
      <div className="px-5 py-3 border-t border-gray-100 dark:border-white/[0.05] bg-gray-50 dark:bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <span className="text-gray-500 text-theme-xs dark:text-gray-400">
            총 {champions.length}개의 챔피언
          </span>
          <span className="text-gray-400 text-theme-xs dark:text-gray-500">
            챔피언을 클릭하여 스킨을 확인하세요
          </span>
        </div>
      </div>
      
      <div className="max-w-full overflow-x-auto">
        <div className="min-w-[800px]">
          <Table>
            {/* Table Header */}
            <TableHeader className="border-b border-gray-100 dark:border-white/[0.05]">
              <TableRow>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  번호
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  챔피언 이미지
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  챔피언 이름
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  포지션
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  티어
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  승률
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  픽률
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  밴률
                </TableCell>
                <TableCell
                  isHeader
                  className="px-5 py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400"
                >
                  스킨 보기
                </TableCell>
              </TableRow>
            </TableHeader>

            {/* Table Body */}
            <TableBody className="divide-y divide-gray-100 dark:divide-white/[0.05]">
              {champions.map((champion, index) => {
                // URL에서 챔피언 키 추출 (예: Aatrox.png -> Aatrox)
                const championKey = champion.championName || 
                  champion.url.split('/').pop()?.replace('.png', '') || 
                  champion.name;
                const rowKey = `${champion.championId ?? champion.name}-${champion.position ?? "ALL"}-${index}`;

                return (
                  <TableRow key={rowKey} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors group">
                    <TableCell className="px-5 py-4 text-start">
                      <span className="text-gray-500 text-theme-sm dark:text-gray-400">
                        {index + 1}
                      </span>
                    </TableCell>
                    <TableCell className="px-5 py-4 text-start">
                      <Link href={`champions/info/${championKey}`}>
                        <div className="w-14 h-14 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 cursor-pointer">
                          <Image
                            width={56}
                            height={56}
                            src={champion.url}
                            alt={champion.name}
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-200"                   
                          />
                        </div>
                      </Link>
                    </TableCell>
                    
                    <TableCell className="px-4 py-3 text-start">
                      <Link 
                        href={`champions/info/${championKey}`}
                        className="font-medium text-gray-800 text-theme-sm dark:text-white/90 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                      >
                        {champion.name}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-start">
                      <div className="flex items-center gap-2 text-theme-sm text-gray-600 dark:text-gray-300">
                        <div className="w-6 h-6 rounded-full overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
                          <Image
                            src={getPositionIcon(champion.position)}
                            alt={champion.position ?? "전체"}
                            width={24}
                            height={24}
                          />
                        </div>
                        <span>{getPositionLabel(champion.position)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-start">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${tierColor(
                          champion.tier
                        )}`}
                      >
                        {tierLabel(champion.tier)}
                      </span>
                    </TableCell>
                    
                    <TableCell className="px-4 py-3 text-start">
                      <span className="text-theme-sm text-gray-600 dark:text-gray-300">
                        {formatPercent(champion.winRate)}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-start">
                      <span className="text-theme-sm text-gray-600 dark:text-gray-300">
                        {formatPercent(champion.pickRate)}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-start">
                      <span className="text-theme-sm text-gray-600 dark:text-gray-300">
                        {formatPercent(champion.banRate)}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-start">
                      <Link
                        href={`champions/skins/${championKey}`}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors duration-200"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        스킨 보기
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      
    </div>
  );
}