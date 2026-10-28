import { DocsNav } from "@/components/docs-nav";

// Docs shell (Console board "Docs components"): a 240 px sticky sidebar beside one content column, at most 840 px wide,
// 44 px between sections. No page title on screen: each page has a hidden h1 and the sidebar shows where you are.
export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="grid grid-cols-1 gap-8 min-[900px]:grid-cols-[240px_minmax(0,1fr)] min-[900px]:gap-12">
      <aside className="min-w-0 min-[900px]:sticky min-[900px]:top-8 min-[900px]:self-start">
        <DocsNav />
      </aside>
      <div className="flex max-w-[840px] min-w-0 flex-col gap-11">{children}</div>
    </div>
  );
}
