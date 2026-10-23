import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/server/store/db";
import { type Answer, ledger, type LedgerRow } from "@/server/store/repo";

export const metadata = { title: "Ledger · NotOnQ" };

const ANSWER: Record<Answer, { label: string; variant: "default" | "secondary" | "outline" }> = {
  notonq: { label: "NotOnQ", variant: "default" },
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
          Every artist looked up through NotOnQ, from any app, and who answered it. Where Qloo had the artist, Qloo answered; where it didn&apos;t,
          NotOnQ did, with a source on every value. Click an artist for the full answer.
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
  const rows = await ledger(await db());
  if (!rows.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No lookups yet</EmptyTitle>
          <EmptyDescription>Look up an artist in the playground, or call the drop-in API or MCP.</EmptyDescription>
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
              <Badge variant={ANSWER[r.answer].variant}>{ANSWER[r.answer].label}</Badge>
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
