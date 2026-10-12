export default function ChampionDetailLoading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">챔피언 정보를 불러오는 중입니다</span>
      <div className="space-y-4">
        <div className="h-5 w-24 animate-pulse rounded bg-surface-2" />
        <div className="aspect-video w-full animate-pulse rounded-xl bg-surface-2 md:aspect-auto md:h-[420px]" />
      </div>
      <div className="space-y-4">
        <div className="h-7 w-16 animate-pulse rounded bg-surface-2" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-4 rounded-lg border border-border bg-surface p-4">
            <div className="size-12 shrink-0 animate-pulse rounded-md bg-surface-2 sm:size-14" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-surface-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
