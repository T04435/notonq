import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Replay } from "@/components/replay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { db } from "@/server/store/db";
import { getRun } from "@/server/store/repo";

export const metadata = { title: "Replay · NotOnQ" };

export default function RunPage({ params }: PageProps<"/ledger/run/[id]">) {
  return (
    <section className="flex flex-col gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit px-0 font-normal text-muted-foreground">
        <Link href="/ledger">
          <ArrowLeftIcon />
          Ledger
        </Link>
      </Button>
      <Suspense fallback={<Spinner />}>
        <RunBody params={params} />
      </Suspense>
    </section>
  );
}

async function RunBody({ params }: { params: PageProps<"/ledger/run/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const run = await getRun(await db(), id);
  if (!run) notFound();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3 border-b pb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{run.kind === "ask" ? "Ask" : "API / MCP"}</Badge>
          {run.appLabel ? <Badge className="bg-muted px-1.5 text-foreground">{run.appLabel}</Badge> : null}
          <time dateTime={run.createdAt}>{new Date(run.createdAt).toUTCString()}</time>
        </div>
        <span className="text-xs text-muted-foreground">{run.kind === "ask" ? "asked" : "called"}</span>
        <h1 className="text-2xl leading-[1.25] font-bold tracking-[-0.03em] break-words sm:text-[32px]">{run.title}</h1>
        {run.summary ? <p className="max-w-[80ch] text-sm text-subtle">{run.summary}</p> : null}
        <p className="max-w-[80ch] text-xs text-muted-foreground">
          A replay of what happened. Nothing is re-run. Raw Qloo API responses are redacted on the server, here as on Ask (the home page); artist
          names and NotOnQ&apos;s additions, checks and verdicts are shown in full.
        </p>
      </header>
      <Replay run={run} />
    </div>
  );
}
