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

/** The links with the current page marked. Reads the URL, so it renders inside <Suspense> (see SiteNavLinks). */
export function SiteNav() {
  return <SiteNavLinks path={usePathname()} />;
}

/** The same links without a current page: the prerendered fallback until the URL is known. */
export function SiteNavLinks({ path }: { path?: string }) {
  const active = (href: string) => !!path && (href === "/" ? path === "/" : path.startsWith(href));
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
