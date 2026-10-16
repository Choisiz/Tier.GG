export default function ChampionsLoading() {
  // min-h-screen: 정적 HTML에서도 이 스켈레톤이 먼저 그려졌다가 표로 바뀐다.
  // 스켈레톤이 화면보다 짧으면 푸터가 화면 안에 있다가 아래로 밀려 CLS가 생긴다 (Review 수정, Lighthouse CLS 0.044 → 0)
  return (
    <div className="min-h-screen space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">챔피언 티어를 불러오는 중입니다</span>
      <div className="space-y-2">
        <div className="h-8 w-40 animate-pulse rounded-md bg-surface-2" />
        <div className="h-4 w-full max-w-md animate-pulse rounded bg-surface-2" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-8 w-16 shrink-0 animate-pulse rounded-full bg-surface-2" />
        ))}
      </div>
      <div className="h-11 w-full animate-pulse rounded-lg bg-surface-2" />
      <ul className="overflow-hidden rounded-lg border border-border">
        {Array.from({ length: 10 }, (_, i) => (
          <li key={i} className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0">
            <div className="h-4 w-6 animate-pulse rounded bg-surface-2" />
            <div className="size-8 shrink-0 animate-pulse rounded-md bg-surface-2" />
            <div className="h-4 flex-1 animate-pulse rounded bg-surface-2" />
            <div className="h-5 w-12 animate-pulse rounded-md bg-surface-2" />
            <div className="h-4 w-20 animate-pulse rounded bg-surface-2" />
          </li>
        ))}
      </ul>
    </div>
  );
}
