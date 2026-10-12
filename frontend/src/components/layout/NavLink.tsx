"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLinkProps = {
  href: string;
  children: React.ReactNode;
};

/** 현재 경로(하위 경로 포함)면 강조 + aria-current="page" */
export default function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
        isActive
          ? "bg-surface-2 text-accent"
          : "text-muted hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  );
}
