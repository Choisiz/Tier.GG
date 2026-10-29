"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 태그를 안 적으면 KR 서버 기본 태그로 간주한다 */
const DEFAULT_TAG_LINE = "KR1";

/**
 * "이름#태그" → { gameName, tagLine }. 마지막 "#"에서 자르고, tagLine 형식(계약 2-5)을 검사한다.
 * "#"이 없으면 이름 전체를 gameName으로 보고 tagLine은 기본값(KR1)을 쓴다.
 */
function parseRiotIdInput(value: string): { gameName: string; tagLine: string } | null {
  const trimmed = value.trim();
  const hashIndex = trimmed.lastIndexOf("#");
  if (hashIndex === -1) {
    if (!trimmed) return null;
    return { gameName: trimmed, tagLine: DEFAULT_TAG_LINE };
  }
  if (hashIndex === 0) return null;
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
      className="relative order-last flex w-full min-w-0 items-center gap-2 sm:order-none sm:ml-auto sm:max-w-[560px] sm:flex-1"
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
        className="w-full h-11 rounded-lg border border-border bg-surface px-4 text-base text-foreground placeholder:text-muted focus:border-accent"
      />
      <button
        type="submit"
        className="h-11 shrink-0 rounded-lg bg-accent px-5 text-base font-semibold text-accent-foreground hover:opacity-90"
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
