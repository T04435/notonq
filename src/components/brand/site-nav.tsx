"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

// Console nav: the logo is home (Ask); the current page is bold with an amber underline.
const LINKS = [
  { href: "/ledger", label: "Ledger" },
  { href: "/proof", label: "Proof" },
  { href: "/docs", label: "Docs" },
];

/** The links with the current page marked. Reads the URL, so it renders inside <Suspense> (see SiteNavLinks). */
export function SiteNav() {
  return <SiteNavLinks path={usePathname()} />;
}

/** The same links without a current page: the prerendered fallback until the URL is known. */
export function SiteNavLinks({ path }: { path?: string }) {
  const active = (href: string) => !!path && path.startsWith(href);
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? "page" : undefined}
          className={cn(
            "decoration-fill decoration-2 underline-offset-[6px] hover:underline",
            active(l.href) ? "font-bold underline" : "text-foreground",
          )}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
