export default function ChampionsLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">챔피언 목록을 불러오는 중입니다</span>
      <div className="h-8 w-40 animate-pulse rounded-md bg-surface-2" />
      <div className="space-y-3">
        <div className="h-11 w-full animate-pulse rounded-lg bg-surface-2" />
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="h-8 w-16 shrink-0 animate-pulse rounded-full bg-surface-2" />
          ))}
        </div>
      </div>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
        {Array.from({ length: 40 }, (_, i) => (
          <li key={i} className="space-y-1.5 p-1.5">
            <div className="aspect-square w-full animate-pulse rounded-md bg-surface-2" />
            <div className="mx-auto h-3 w-3/4 animate-pulse rounded bg-surface-2" />
          </li>
        ))}
      </ul>
    </div>
  );
}
