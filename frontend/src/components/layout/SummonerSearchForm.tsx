"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "이름#태그" → { gameName, tagLine }. 마지막 "#"에서 자르고, tagLine 형식(계약 2-5)을 검사한다 */
function parseRiotIdInput(value: string): { gameName: string; tagLine: string } | null {
  const trimmed = value.trim();
  const hashIndex = trimmed.lastIndexOf("#");
  if (hashIndex <= 0) return null;
  const gameName = trimmed.slice(0, hashIndex).trim();
  const tagLine = trimmed.slice(hashIndex + 1).trim();
  if (!gameName || !/^[0-9A-Za-z]{2,5}$/.test(tagLine)) return null;
  return { gameName, tagLine };
}

/**
 * 헤더 전역 전적 검색창 (D28). "이름#태그" 입력 → 제출 시 `#`→`-`로 바꿔 `/summoners/kr/{riotId}`로 이동.
 * 형식 오류는 서버에 요청을 보내지 않고 입력창 아래 안내로 막는다 (4장 상태 처리).
 */
export default function SummonerSearchForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseRiotIdInput(value);
    if (!parsed) {
      setError("이름#태그 형식으로 입력해 주세요");
      return;
    }
    setError(null);
    router.push(`/summoners/kr/${encodeURIComponent(`${parsed.gameName}-${parsed.tagLine}`)}`);
  }

  return (
    <form
      role="search"
      aria-label="전적 검색"
      onSubmit={handleSubmit}
      className="relative ml-auto flex min-w-0 max-w-xs flex-1 items-center gap-2"
    >
      <label htmlFor="riotid-search" className="sr-only">
        소환사 이름#태그 검색
      </label>
      <input
        id="riotid-search"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="이름#태그 (예: 너희는개다#KR1)"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "riotid-search-error" : undefined}
        className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent"
      />
      <button
        type="submit"
        className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-accent-foreground hover:opacity-90"
      >
        검색
      </button>
      {error ? (
        <p
          id="riotid-search-error"
          role="alert"
          className="absolute top-full left-0 mt-1 text-xs text-red-400"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}
