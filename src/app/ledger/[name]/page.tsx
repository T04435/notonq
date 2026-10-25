import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Result } from "@/components/playground";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { storedView } from "@/server/playground";
import { redactQlooIds } from "@/server/redact";
import { db } from "@/server/store/db";
import { claimsFor, demandByApp, demandFor, findFallback } from "@/server/store/repo";

export const metadata = { title: "Ledger · NotOnQ" };

// A read-only view of one Ledger row: what NotOnQ has stored for the artist, where the demand came from, and every
// research claim with its verdict. Viewing it makes no lookup and counts as no demand.
export default function LedgerEntryPage({ params }: PageProps<"/ledger/[name]">) {
  return (
    <section className="flex flex-col gap-6">
      <Button asChild variant="link" className="w-fit px-0 text-muted-foreground">
        <Link href="/ledger">
          <ArrowLeftIcon />
          Ledger
        </Link>
      </Button>
      <Suspense fallback={<Spinner />}>
        <Entry params={params} />
      </Suspense>
    </section>
  );
}

async function Entry({ params }: { params: PageProps<"/ledger/[name]">["params"] }) {
  await connection();
  const nameKey = decodeURIComponent((await params).name);
  const sql = await db();
  const [f, demand, origin] = await Promise.all([findFallback(sql, { nameKey }), demandFor(sql, nameKey), demandByApp(sql, nameKey)]);
  // Ask about this artist on the home page, side by side with Qloo (prefilled; asking stays a click).
  const ask = `/?${new URLSearchParams({ q: `Tell me about the artist ${origin.query}: who are they, and what artists would their fans like?` })}`;

  if (origin.latest === "qloo")
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{origin.query}</EmptyTitle>
          <EmptyDescription>Answered by Qloo: it has this artist, so NotOnQ stepped aside and passed Qloo&apos;s answer through unchanged.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href={ask}>Ask about it, side by side with Qloo</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );

  if (!f?.entity)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{origin.query}</EmptyTitle>
          <EmptyDescription>
            {f ? "No source knew this name when it was last asked; it stays in the Ledger as demand." : "Asked for, but nobody has chosen which artist it is yet."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href={ask}>Ask about it, side by side with Qloo</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );

  const claims = await claimsFor(sql, f.id);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{f.name}</h1>
        <Button asChild variant="outline" size="sm">
          <Link href={ask}>Ask about it, side by side with Qloo</Link>
        </Button>
      </header>

      <Result view={redactQlooIds(storedView(f, demand))} />

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Where the demand came from</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>App</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Callers</TableHead>
              <TableHead className="text-right">Last asked</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {origin.apps.map((a) => (
              <TableRow key={a.app}>
                <TableCell className="font-mono text-xs">{a.app}</TableCell>
                <TableCell className="text-right">{a.requests}</TableCell>
                <TableCell className="text-right">{a.callers}</TableCell>
                <TableCell className="text-right">{a.last ? new Date(a.last).toUTCString() : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {claims.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Research claims</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Quote</TableHead>
                <TableHead>Verdict</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((c, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">{c.field}</TableCell>
                  <TableCell className="max-w-48 whitespace-normal">{c.value}</TableCell>
                  <TableCell className="max-w-72 whitespace-normal text-xs text-muted-foreground">
                    &quot;{c.quote}&quot;{" "}
                    <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                      source
                    </a>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {c.verified ? <Badge>verified · {c.confidence}</Badge> : <Badge variant="outline">rejected: {c.reason}</Badge>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
