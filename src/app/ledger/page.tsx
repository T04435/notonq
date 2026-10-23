import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/server/store/db";
import { importQueue, totals } from "@/server/store/repo";

export const metadata = { title: "Ledger · NotOnQ" };

export default function LedgerPage() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Ledger</h1>
        <p className="text-muted-foreground">
          Artists developers asked for that Qloo had no data for, ranked by how many separate callers asked. Each row carries only IDs Qloo&apos;s own
          /entities endpoint accepts and the stand-ins Qloo already knows: no copied data.
        </p>
      </header>
      <Suspense fallback={<Spinner />}>
        <Queue />
      </Suspense>
      <AutoRefresh />
    </section>
  );
}

async function Queue() {
  await connection();
  const sql = await db();
  const [rows, t] = await Promise.all([importQueue(sql), totals(sql)]);
  if (!rows.length)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No gaps recorded yet</EmptyTitle>
          <EmptyDescription>Look up an artist Qloo doesn&apos;t know in the playground, or call the drop-in API.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t.entities} missing artists · {t.gapRequests} gap requests · {t.cacheHits} served from cache · {t.callers} distinct callers · updates live · click an artist to see its results
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Artist</TableHead>
            <TableHead>Gap</TableHead>
            <TableHead className="text-right">Callers</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead>IDs</TableHead>
            <TableHead>Stand-ins</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.nameKey}>
              <TableCell className="font-medium">
                <Link href={`/ledger/${encodeURIComponent(r.nameKey)}`} className="underline-offset-4 hover:underline">
                  {r.name ?? r.query}
                </Link>
                {!r.entityId && (
                  <Badge variant="outline" className="ml-2">
                    {r.askedToChoose ? "awaiting a choice" : "nothing found yet"}
                  </Badge>
                )}
                {r.confidence === "low" && (
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
                <Badge variant="outline">{r.gapKind === "G2" ? "not in taste graph" : "unknown to Qloo"}</Badge>
              </TableCell>
              <TableCell className="text-right">{r.callers}</TableCell>
              <TableCell className="text-right">{r.requests}</TableCell>
              <TableCell className="font-mono text-xs">
                {r.mbid && (
                  <a className="block hover:underline" href={`https://musicbrainz.org/artist/${r.mbid}`}>
                    mbid {r.mbid.slice(0, 8)}
                  </a>
                )}
                {r.qid && (
                  <a className="block hover:underline" href={`https://www.wikidata.org/wiki/${r.qid}`}>
                    {r.qid}
                  </a>
                )}
                {r.spotifyId && <span className="block">spotify {r.spotifyId.slice(0, 8)}</span>}
              </TableCell>
              <TableCell className="max-w-64 whitespace-normal text-xs text-muted-foreground">{r.standIns.map((s) => s.name).join(", ") || "none"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
