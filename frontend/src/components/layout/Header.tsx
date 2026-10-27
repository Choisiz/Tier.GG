import Link from "next/link";
import SummonerSearchForm from "./SummonerSearchForm";
import NavLink from "./NavLink";

/** 메뉴는 이 배열에 추가만 하면 된다. */
const NAV_ITEMS = [{ href: "/champions", label: "챔피언" }];

export default function Header() {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-full w-full max-w-6xl items-center gap-4 px-4 sm:gap-6 sm:px-6">
        <Link href="/" className="shrink-0 text-lg font-extrabold tracking-tight">
          Tier<span className="text-accent">.GG</span>
        </Link>
        <nav aria-label="주요 메뉴" className="shrink-0">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <SummonerSearchForm />
      </div>
    </header>
  );
}
