import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "페이지를 찾을 수 없습니다",
};

export default function NotFound() {
  return (
    <section className="flex flex-col items-center gap-4 py-20 text-center">
      <p className="text-sm font-semibold text-accent">404</p>
      <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
      <p className="text-muted">주소가 올바른지 확인해 주세요.</p>
      <Link
        href="/"
        className="rounded-md bg-accent px-4 py-2 font-semibold text-accent-foreground hover:opacity-90"
      >
        홈으로
      </Link>
    </section>
  );
}
