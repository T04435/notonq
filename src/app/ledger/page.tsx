import { connection } from "next/server";
import { Suspense } from "react";
import { type LedgerData, LiveLedger } from "@/components/ledger/live-ledger";
import { PageSpinner } from "@/components/ui/spinner";
import { parseLedgerParams } from "@/lib/ledger-params";
import { db } from "@/server/store/db";
import { artistCursor, ledger } from "@/server/store/repo";
import { latestChange, ledgerApps, listVisits, visitCalls } from "@/server/store/visits";

export const metadata = { title: "Ledger · NotOnQ" };

const TOP = 5;
const ARTIST_PAGE = 50;

// The Ledger is the record: every visit through NotOnQ, live, with a filter by artist. Everything is in the URL.
export default function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  return (
    <section className="flex flex-col gap-9">
      <h1 className="sr-only">Ledger</h1>
      <Suspense fallback={<PageSpinner />}>
        <Data searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function Data({ searchParams }: { searchParams: PageProps<"/ledger">["searchParams"] }) {
  await connection();
  const params = parseLedgerParams(await searchParams);
  const sql = await db();
  const [renderedAt, apps, top, visits, openCalls, panel] = await Promise.all([
    latestChange(sql),
    ledgerApps(sql),
    ledger(sql, { order: "asked", limit: TOP }),
    listVisits(sql, params),
    params.open ? visitCalls(sql, params.open) : undefined,
    params.artists ? ledger(sql, { order: "asked", app: params.app, result: params.result, before: params.apage, limit: ARTIST_PAGE }) : undefined,
  ]);
  const last = panel?.at(-1);
  const data: LedgerData = {
    params,
    renderedAt: params.at ?? renderedAt,
    apps,
    top: { rows: [...top], total: top.total ?? top.length },
    visits,
    openCalls,
    artists: panel
      ? { rows: [...panel], total: panel.total ?? panel.length, filled: panel.filled ?? 0, next: panel.length === ARTIST_PAGE && last ? artistCursor(last, "asked") : undefined }
      : undefined,
  };
  return <LiveLedger data={data} />;
}
