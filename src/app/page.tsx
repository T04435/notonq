import { Suspense } from "react";
import { Playground } from "@/components/playground";

export default function Home() {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">NotOnQ</h1>
        <p className="text-muted-foreground">
          When the Qloo API has no data for an artist, NotOnQ returns the same shape from open sources, with a source on every value. Taste data still
          comes from Qloo, through similar artists it does know. Every answer is cached, and every request counts towards a ranked list of what Qloo
          is missing.
        </p>
      </header>
      {/* The playground reads ?q= deep links, so it renders inside a Suspense boundary. */}
      <Suspense>
        <Playground />
      </Suspense>
    </section>
  );
}
