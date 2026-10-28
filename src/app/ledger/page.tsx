import { connection } from "next/server";
import { Suspense } from "react";
import { type LedgerData, LiveLedger } from "@/components/ledger/live-ledger";
import { PageSpinner } from "@/components/ui/spinner";
import { parseLedgerParams } from "@/lib/ledger-params";
import { db } from "@/server/store/db";
import { latestChange, ledgerApps, listVisits, visitCalls } from "@/server/store/visits";

export const metadata = { title: "Ledger · NotOnQ" };

// The Ledger is the record: every visit through NotOnQ, live. Everything is in the URL.
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
  const [renderedAt, apps, visits, openCalls] = await Promise.all([
    latestChange(sql),
    ledgerApps(sql),
    listVisits(sql, params),
    params.open ? visitCalls(sql, params.open) : undefined,
  ]);
  const data: LedgerData = { params, renderedAt: params.at ?? renderedAt, apps, visits, openCalls };
  return <LiveLedger data={data} />;
}
