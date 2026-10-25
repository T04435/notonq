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
      <Button asChild variant="ghost" size="sm" className="w-fit px-0">
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
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{run.kind === "ask" ? "Ask" : "API / MCP"}</Badge>
          {run.appLabel ? <span>{run.appLabel}</span> : null}
          <time dateTime={run.createdAt}>{new Date(run.createdAt).toUTCString()}</time>
        </div>
        <h1 className="text-xl font-semibold break-words">{run.title}</h1>
        {run.summary ? <p className="text-sm text-muted-foreground">{run.summary}</p> : null}
        <p className="text-xs text-muted-foreground">A replay of what happened, with the original results. Nothing is re-run.</p>
      </header>
      <Replay run={run} />
    </div>
  );
}
