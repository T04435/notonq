"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

const PAGES = [
  { href: "/docs", label: "Overview" },
  { href: "/docs/rest", label: "REST API" },
  { href: "/docs/mcp", label: "MCP" },
  { href: "/openapi.json", label: "OpenAPI" },
  { href: "/llms.txt", label: "llms.txt" },
];

export function DocsNav() {
  const path = usePathname();
  return (
    <nav className="flex flex-wrap gap-1" aria-label="Docs">
      {PAGES.map((p) => (
        <Button key={p.href} asChild size="sm" variant={path === p.href ? "secondary" : "ghost"}>
          <Link href={p.href}>{p.label}</Link>
        </Button>
      ))}
    </nav>
  );
}
