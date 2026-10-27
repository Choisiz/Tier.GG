"use client";

import { useEffect } from "react";

/** 404 SUMMONER_NOT_FOUND / region 오류. 헤더 검색창(`#riotid-search`)에 다시 포커스한다 */
export default function SummonerNotFound() {
  useEffect(() => {
    document.getElementById("riotid-search")?.focus();
  }, []);

  return (
    <section className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="text-2xl font-bold">소환사를 찾을 수 없습니다</h1>
      <p className="text-muted">이름#태그를 확인해 주세요.</p>
    </section>
  );
}
