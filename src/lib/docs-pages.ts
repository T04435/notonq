// The docs pages and their sections, in sidebar order. Each page renders its sections with these ids, so the sidebar's
// section links always land. Kept in step with llms.txt (src/server/llms.ts).

export type DocsSection = { id: string; label: string };
export type DocsPage = { href: string; label: string; sections: DocsSection[] };

export const DOCS_PAGES: DocsPage[] = [
  {
    href: "/docs",
    label: "Overview",
    sections: [
      { id: "quickstart", label: "Quickstart" },
      { id: "when", label: "When NotOnQ fills in" },
      { id: "shape", label: "Same shape as Qloo" },
      { id: "sources", label: "A source on every value" },
      { id: "ask", label: "Ask" },
      { id: "ledger", label: "The Ledger" },
      { id: "proof", label: "Proof" },
      { id: "redaction", label: "Qloo's data on our pages" },
      { id: "caching", label: "Caching and budgets" },
      { id: "inside-qloo", label: "Inside Qloo" },
      { id: "limits", label: "Known limits" },
    ],
  },
  {
    href: "/docs/rest",
    label: "REST API",
    sections: [
      { id: "base", label: "Base URL and headers" },
      { id: "endpoints", label: "Endpoints" },
      { id: "search", label: "GET /search" },
      { id: "insights", label: "/v2/insights" },
      { id: "notonq-block", label: "The notonq block" },
      { id: "status", label: "Status codes" },
    ],
  },
  {
    href: "/docs/mcp",
    label: "MCP",
    sections: [
      { id: "setup", label: "Qloo's own MCP server" },
      { id: "agent", label: "What the agent sees" },
      { id: "tools", label: "Tools" },
      { id: "exchange", label: "A real exchange" },
    ],
  },
];

export const MACHINE_READABLE = ["/openapi.json", "/llms.txt", "/llms-full.txt"];

/** The sections of the page at `href`, for building it. */
export const sectionsOf = (href: string) => DOCS_PAGES.find((p) => p.href === href)?.sections ?? [];
