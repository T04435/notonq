"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

// Lowercase paths, as the Schema brand writes them; the current one is bold and underlined.
const LINKS = [
  { href: "/", label: "/playground" },
  { href: "/ledger", label: "/ledger" },
  { href: "/proof", label: "/proof" },
  { href: "/docs", label: "/docs" },
];

export function SiteNav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className={cn(
            "underline-offset-[5px] hover:underline",
            active(l.href) ? "font-bold underline" : "text-foreground",
          )}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
