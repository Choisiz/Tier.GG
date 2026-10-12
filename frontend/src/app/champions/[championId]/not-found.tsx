import Link from "next/link";

export default function ChampionNotFound() {
  return (
    <section className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="text-2xl font-bold">챔피언을 찾을 수 없습니다</h1>
      <p className="text-muted">이름이 바뀌었거나 존재하지 않는 챔피언입니다.</p>
      <Link
        href="/champions"
        className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-foreground hover:opacity-90"
      >
        챔피언 목록으로
      </Link>
    </section>
  );
}
