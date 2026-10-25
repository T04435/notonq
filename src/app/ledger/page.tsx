import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { NotOnQBadge } from "@/components/brand/notonq-badge";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/server/store/db";
import { type Answer, ledger, type LedgerRow, listRuns, type Run } from "@/server/store/repo";

export const metadata = { title: "Ledger · NotOnQ" };

const ANSWER: Record<Answer, { label: string; variant: "notonq" | "secondary" | "outline" }> = {
  notonq: { label: "NotOnQ", variant: "notonq" },
  qloo: { label: "Qloo", variant: "secondary" },
  choice: { label: "Awaiting a choice", variant: "outline" },
  none: { label: "Nothing found yet", variant: "outline" },
};

export default function LedgerPage() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Ledger</h1>
        <p className="text-muted-foreground">
          Every request made through NotOnQ: questions asked on the Ask page, and calls from apps and Qloo&apos;s MCP. Open one to replay it step by
          step, with its original results. The Artists tab counts every artist looked up, and who answered it.
        </p>
      </header>
      <Suspense fallback={<Spinner />}>
        <Rows />
      </Suspense>
      <AutoRefresh />
    </section>
  );
}

async function Rows() {
  await connection();
  const sql = await db();
  const [rows, runs] = await Promise.all([ledger(sql), listRuns(sql)]);
  return (
    <Tabs defaultValue="requests">
      <TabsList>
        <TabsTrigger value="requests">Requests ({runs.length})</TabsTrigger>
        <TabsTrigger value="artists">Artists ({rows.length})</TabsTrigger>
      </TabsList>
      <TabsContent value="requests">
        <Requests runs={runs} />
      </TabsContent>
      <TabsContent value="artists">
        <Artists rows={rows} />
      </TabsContent>
    </Tabs>
  );
}

function Requests({ runs }: { runs: Run[] }) {
  if (!runs.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No requests yet</EmptyTitle>
          <EmptyDescription>Ask a question on the home page, or call the drop-in API or Qloo&apos;s MCP through NotOnQ.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When (UTC)</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Request</TableHead>
          <TableHead>App</TableHead>
          <TableHead>Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{r.createdAt.slice(0, 16).replace("T", " ")}</TableCell>
            <TableCell>
              <Badge variant="outline">{r.kind === "ask" ? "Ask" : "API"}</Badge>
            </TableCell>
            <TableCell className="max-w-md font-medium whitespace-normal break-words">
              <Link href={`/ledger/run/${r.id}`} className="underline-offset-4 hover:underline">
                {r.title}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs">{r.appLabel ?? "unlabelled"}</TableCell>
            <TableCell className="max-w-sm text-xs whitespace-normal text-muted-foreground">{r.summary ?? r.servedBy ?? ""}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Artists({ rows }: { rows: LedgerRow[] }) {
  if (!rows.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No lookups yet</EmptyTitle>
          <EmptyDescription>Ask a question on the home page, or call the drop-in API or Qloo&apos;s MCP through NotOnQ.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  const by = (a: Answer[]) => rows.filter((r) => a.includes(r.answer));
  const notonq = by(["notonq"]);
  const lookups = rows.reduce((n, r) => n + r.requests, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        NotOnQ answered {notonq.length} of {rows.length} artists · {lookups} lookups · updates live
      </p>
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({rows.length})</TabsTrigger>
          <TabsTrigger value="notonq">NotOnQ ({notonq.length})</TabsTrigger>
          <TabsTrigger value="qloo">Qloo ({by(["qloo"]).length})</TabsTrigger>
          <TabsTrigger value="waiting">Waiting ({by(["choice", "none"]).length})</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <LedgerTable rows={rows} />
        </TabsContent>
        <TabsContent value="notonq">
          <LedgerTable rows={notonq} />
        </TabsContent>
        <TabsContent value="qloo">
          <LedgerTable rows={by(["qloo"])} />
        </TabsContent>
        <TabsContent value="waiting">
          <LedgerTable rows={by(["choice", "none"])} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Artist</TableHead>
          <TableHead>Answered by</TableHead>
          <TableHead className="text-right">Lookups</TableHead>
          <TableHead className="text-right">Callers</TableHead>
          <TableHead>Apps</TableHead>
          <TableHead>Stand-ins</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.nameKey}>
            <TableCell className="font-medium">
              <Link href={`/ledger/${encodeURIComponent(r.nameKey)}`} className="underline-offset-4 hover:underline">
                {r.name}
              </Link>
              {r.confidence === "low" && r.answer === "notonq" && (
                <Badge variant="outline" className="ml-2">
                  low confidence
                </Badge>
              )}
              {r.resolvedByQlooAt && (
                <Badge variant="secondary" className="ml-2">
                  now in Qloo
                </Badge>
              )}
            </TableCell>
            <TableCell>
              {r.answer === "notonq" ? <NotOnQBadge>NotOnQ</NotOnQBadge> : <Badge variant={ANSWER[r.answer].variant}>{ANSWER[r.answer].label}</Badge>}
            </TableCell>
            <TableCell className="text-right">{r.requests}</TableCell>
            <TableCell className="text-right">{r.callers}</TableCell>
            <TableCell className="max-w-48 whitespace-normal font-mono text-xs">{r.apps.join(", ")}</TableCell>
            <TableCell className="max-w-64 whitespace-normal text-xs text-muted-foreground">{r.standIns.map((s) => s.name).join(", ") || "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
