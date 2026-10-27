export default function SummonerLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">소환사 정보를 불러오는 중입니다</span>
      <div className="h-24 w-full animate-pulse rounded-lg bg-surface-2" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      </div>
    </div>
  );
}
