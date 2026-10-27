import { connection } from "next/server";
import { Suspense } from "react";
import { type LedgerData, LiveLedger } from "@/components/ledger/live-ledger";
import { Spinner } from "@/components/ui/spinner";
import { parseLedgerParams } from "@/lib/ledger-params";
import { db } from "@/server/store/db";
import { ledger } from "@/server/store/repo";
import { latestChange, ledgerSummary, listVisits, visitCalls } from "@/server/store/visits";

export const metadata = { title: "Ledger · NotOnQ" };

export default function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Ledger</h1>
        <p className="max-w-3xl text-muted-foreground">
          Every request made through NotOnQ, live: questions asked on the Ask page, and calls from apps and Qloo&apos;s MCP, grouped into visits. Open a
          visit to see its calls and replay any of them with its original results. Filters, pages and pauses are in the address, so a copied link opens
          the same view.
        </p>
      </header>
      <Suspense fallback={<Spinner />}>
        <Data searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function Data({ searchParams }: { searchParams: PageProps<"/ledger">["searchParams"] }) {
  await connection();
  const params = parseLedgerParams(await searchParams);
  const sql = await db();
  const [renderedAt, summary] = await Promise.all([latestChange(sql), ledgerSummary(sql)]);
  const data: LedgerData = { params, renderedAt: params.at ?? renderedAt, summary };
  if (params.tab === "requests") {
    [data.visits, data.openCalls] = await Promise.all([listVisits(sql, params), params.open ? visitCalls(sql, params.open) : undefined]);
  } else {
    const rows = await ledger(sql, { app: params.app, result: params.result, q: params.q, before: params.before, limit: 50 });
    const last = rows.at(-1);
    data.artists = { rows: [...rows], total: rows.total ?? rows.length, next: rows.length === 50 && last ? `${last.lastRequested}~${last.nameKey}` : undefined };
  }
  return <LiveLedger data={data} />;
}
