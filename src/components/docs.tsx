import { cn } from "cn";
import Link from "next/link";
import type { ReactNode } from "react";
import { DocsCode } from "@/components/code";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// The docs building blocks, as the Console board "Docs components" draws them. Each is a thin layout over the app's
// tokens and shadcn components (Alert, Table, Tabs, Badge, Code Block).

/** One section of a docs page: an h2 (18 px, 700) and its content. `id` matches the sidebar (src/lib/docs-pages.ts). */
export function DocsSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flex scroll-mt-8 flex-col gap-4">
      <h2 id={`${id}-h`} className="text-lg leading-[1.3] font-bold tracking-[-0.02em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A sub-heading inside a section (14 px, 700). */
export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-2 text-sm leading-[1.4] font-bold tracking-normal">{children}</h3>;
}

/** Body text: 14 px, line 1.75, at most 72 characters. */
export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("max-w-[72ch] text-sm leading-[1.75] text-subtle", className)}>{children}</p>;
}

/** A list, one idea per item. */
export function Ul({ children }: { children: ReactNode }) {
  return <ul className="flex max-w-[72ch] list-disc flex-col gap-2 pl-[18px] text-sm leading-[1.7] text-subtle">{children}</ul>;
}

/** Inline code on a dark chip, for keys, paths and values. */
export function C({ children }: { children: ReactNode }) {
  return <code className="bg-raised px-[5px] py-px text-[13px] text-foreground">{children}</code>;
}

/** An underlined link; internal paths go through Next's Link, files and other sites stay plain anchors. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  const cls = "text-foreground underline underline-offset-4";
  const page = href.startsWith("/") && !/\.(json|txt)$/.test(href);
  return page ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <a href={href} className={cls}>
      {children}
    </a>
  );
}

/** At most one per page: a scope or limit that covers everything below it. An amber lead, then one sentence. */
export function Notice({ lead, children }: { lead: string; children: ReactNode }) {
  return (
    <Alert variant="notice" role="note">
      <b className="font-medium text-fill">{lead}</b> {children}
    </Alert>
  );
}

/** A reference table (fields, headers, parameters, status codes): first column in mono white, the rest dim. It
 * scrolls sideways inside its box on a phone. */
export function RefTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="border">
      <Table className="min-w-[680px]">
        <TableHeader>
          <TableRow>
            {head.map((h) => (
              <TableHead key={h} className="py-[9px]">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i} className="hover:bg-transparent">
              {row.map((cell, j) => (
                <TableCell key={j} className={cn("py-2.5 align-top leading-[1.6]", j === 0 ? "text-foreground" : "whitespace-normal text-subtle")}>
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** An endpoint table: a method tag, then the path (GET plain, POST amber), then what NotOnQ does. */
export function EndpointTable({ rows }: { rows: [method: "GET" | "POST" | null, path: string, what: ReactNode][] }) {
  return (
    <RefTable
      head={["endpoint", "what NotOnQ does"]}
      rows={rows.map(([method, path, what]) => [
        <span key="e">
          {method ? (
          <Badge variant={method === "POST" ? "notonq" : "outline"} className={cn("mr-1.5 h-auto px-1.5 py-0 align-[1px]", method !== "POST" && "text-foreground")}>
            {method}
          </Badge>
          ) : null}
          {path}
        </span>,
        what,
      ])}
    />
  );
}

/** The same task done different ways: tabs sitting directly on the code block. */
export function CodeTabs({ label, tabs }: { label: string; tabs: { value: string; label: string; code: string; language: string; title: string; after?: ReactNode }[] }) {
  return (
    <Tabs defaultValue={tabs[0].value} className="gap-0">
      <TabsList variant="line" aria-label={label} className="w-full justify-start gap-0 border-b p-0 group-data-horizontal/tabs:h-auto">
        {tabs.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="min-h-9 flex-none px-3.5 text-[13px] font-normal text-muted-foreground after:bottom-[-1px] after:bg-fill data-active:text-foreground group-data-horizontal/tabs:after:bottom-[-1px]"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="flex flex-col gap-4">
          <DocsCode code={t.code} language={t.language} title={t.title} className="border-t-0" />
          {t.after}
        </TabsContent>
      ))}
    </Tabs>
  );
}
