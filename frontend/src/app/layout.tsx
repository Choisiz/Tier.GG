import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    template: "%s | Tier.GG",
    default: "Tier.GG",
  },
  description: "리그 오브 레전드 챔피언 티어와 추천 빌드, 스킨을 한눈에 볼 수 있는 Tier.GG",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-accent-foreground"
        >
          본문으로 건너뛰기
        </a>
        <Header />
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 focus:outline-none sm:px-6 sm:py-8"
        >
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
