"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({
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
      <h1 className="text-2xl font-bold">데이터를 불러오지 못했습니다</h1>
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
