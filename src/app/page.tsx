import { Suspense } from "react";
import { Ask } from "@/components/ask";
import { Badge } from "@/components/ui/badge";

export default function Home() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">NotOnQ</h1>
        <p className="text-muted-foreground">
          Ask what you would ask Qloo&apos;s own MCP server. The same harness answers twice: once straight from Qloo, once through NotOnQ. NotOnQ
          never hides Qloo&apos;s answer: it checks whether that answer meets the question, asks Qloo again if not, and only then adds open data,
          labelled, with a source on every value.
        </p>
        <p className="text-sm text-muted-foreground">
          <Badge variant="secondary">Artists only</Badge> For the Qloo Agentic Hackathon, NotOnQ fills music artists. Every other entity type passes
          straight through to Qloo, unchanged.
        </p>
      </header>
      {/* Ask reads ?q= (links from the Ledger), so it renders inside a Suspense boundary. */}
      <Suspense>
        <Ask />
      </Suspense>
    </section>
  );
}
