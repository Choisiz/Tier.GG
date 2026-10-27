"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * 예상 밖의 오류(Data Dragon 실패 등)만 여기로 온다. Riot 502/503·백엔드 연결 실패는
 * `page.tsx`가 `SummonerStatus`로 직접 그린다 — production 빌드는 서버에서 던진 오류의
 * `message`를 클라이언트로 보내지 않아(Next 보안 동작) 이 경계에서 상황별 문구를 고를 수 없다.
 */
export default function SummonerError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section role="alert" className="flex flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-2xl font-bold">전적을 불러오지 못했습니다</h1>
      <p className="text-muted">잠시 후 다시 시도해 주세요.</p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-foreground hover:opacity-90"
        >
          다시 시도
        </button>
        <Link
          href="/champions"
          className="rounded-md border border-border px-4 py-2 font-semibold hover:bg-surface-2"
        >
          챔피언 목록으로
        </Link>
      </div>
    </section>
  );
}
