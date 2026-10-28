"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOCS_PAGES, MACHINE_READABLE } from "@/lib/docs-pages";

const item = "block border-l py-1.5 pr-2.5 pl-2.5 text-[13px] text-subtle no-underline hover:text-foreground";
const current = "border-l-2 border-l-fill pl-[9px] font-medium text-foreground";

/** The docs sidebar: the pages, the current page's sections indented, then the machine-readable files. Under 900 px it
 * sits above the content and drops the section links. */
export function DocsNav() {
  const path = usePathname();
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Docs">
        <ul className="flex flex-col">
          {DOCS_PAGES.map((p) => {
            const here = path === p.href;
            return (
              <li key={p.href}>
                <Link href={p.href} aria-current={here ? "page" : undefined} className={cn(item, here && current)}>
                  {p.label}
                </Link>
                {here ? (
                  <ul className="hidden min-[900px]:flex min-[900px]:flex-col" aria-label={`${p.label} sections`}>
                    {p.sections.map((s) => (
                      <li key={s.id}>
                        <a href={`#${s.id}`} className={cn(item, "pl-6 text-xs text-muted-foreground")}>
                          {s.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </nav>
      <div>
        <div className="px-2.5 pb-1.5 text-[11px] tracking-[0.08em] text-dim uppercase" id="docs-machine">
          machine-readable
        </div>
        <ul className="flex flex-col" aria-labelledby="docs-machine">
          {MACHINE_READABLE.map((href) => (
            <li key={href}>
              <a href={href} className={item}>
                {href}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
