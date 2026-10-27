import Image from "next/image";
import type { SummonerProfileView } from "@/lib/view/summoner";

/** 프로필 헤더. 재검색 폼은 없다 — 헤더 전역 검색창과 중복이라 뺀다 (2026-10-27 사용자 교정) */
export default function ProfileHeader({ profile }: { profile: SummonerProfileView }) {
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-surface p-4">
      <span className="relative block size-16 shrink-0 overflow-hidden rounded-lg bg-surface-2 sm:size-[72px]">
        <Image src={profile.iconUrl} alt="" fill sizes="72px" className="object-cover" />
      </span>
      <div className="min-w-0">
        <h1 className="text-xl font-bold">
          {profile.gameName}{" "}
          <span className="font-normal text-muted">#{profile.tagLine}</span>
        </h1>
        <p className="text-sm text-muted">레벨 {profile.level} · KR</p>
      </div>
    </section>
  );
}
