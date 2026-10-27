import { Suspense } from "react";
import { Ask } from "@/components/ask";

// Home is Ask: the question box is the hero, and a question turns the page into a chat on the same URL.
export default function Home() {
  return (
    // Ask reads ?q= (links from the Ledger prefill the question), so it renders inside a Suspense boundary.
    <Suspense>
      <Ask />
    </Suspense>
  );
}
