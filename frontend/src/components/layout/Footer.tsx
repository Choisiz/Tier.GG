import { getLatestVersion } from "@/lib/ddragon/api";

async function PatchVersion() {
  const version = await getLatestVersion().catch(() => null);
  return <>{version ? `패치 ${version}` : "패치 정보 없음"}</>;
}

export default function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-6xl space-y-1 px-4 py-6 text-xs text-muted sm:px-6">
        <p>
          <PatchVersion /> · 데이터: Riot Data Dragon
        </p>
        <p>
          Tier.GG는 Riot Games의 보증을 받지 않았으며 Riot Games 또는 League of Legends의
          제작·관리에 관여한 사람의 공식 입장을 반영하지 않습니다. League of Legends 및 Riot
          Games는 Riot Games, Inc.의 상표 또는 등록 상표입니다.
        </p>
      </div>
    </footer>
  );
}
