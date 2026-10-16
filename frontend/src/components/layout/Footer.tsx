import { getMeta } from "@/lib/api/api";

/**
 * 공개 패치 이름 (`/meta`의 최신 패치 `displayName`, 변경 01 D5).
 * 푸터는 루트 레이아웃이라 error.tsx가 감싸지 못하므로 실패해도 던지지 않는다.
 */
async function PatchVersion() {
  const meta = await getMeta();
  const latest = meta.status === "ok" ? meta.data.window.patches[0] : undefined;
  return <>{latest ? `패치 ${latest.displayName}` : "패치 정보 없음"}</>;
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
