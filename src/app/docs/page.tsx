import { CodeBlock } from "@/components/ai-elements/code-block";

export const metadata = { title: "Use it · NotOnQ" };

const REST = `# Same paths and parameters as the Qloo API, under /q. Your own keys.
curl -H "X-Api-Key: $QLOO_API_KEY" \\
     -H "X-Lastfm-Key: $LASTFM_API_KEY" \\
     -H "X-NotOnQ-App: my-app" \\
  "https://<notonq-host>/q/search?types=urn:entity:artist&query=sombr"

# A notonq: ID works as a signal anywhere Qloo takes one: it is swapped for its stand-ins.
curl -H "X-Api-Key: $QLOO_API_KEY" \\
  "https://<notonq-host>/q/v2/insights?filter.type=urn:entity:place&signal.interests.entities=notonq:mbid:<uuid>&filter.location.query=Melbourne"`;

const HARNESS = `# The official Qloo harness (@qloo/qloo-harness) reads these two variables:
QLOO_BASE_URL=https://<notonq-host>/q \\
QLOO_TRUSTED_BASE_URL=https://<notonq-host>/q \\
qloo mcp`;

export default function DocsPage() {
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Use NotOnQ</h1>
      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Drop-in REST</h2>
        <p className="text-sm text-muted-foreground">
          Change the base URL. When Qloo answers, you get Qloo&apos;s response unchanged. When Qloo has a gap, you get a Qloo-shaped entity built from
          open data, plus a <code>notonq</code> block with the gap type, the stand-ins, the cache state, the demand and a source for every value.
        </p>
        <CodeBlock code={REST} language="bash" />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-medium">With the official Qloo harness</h2>
        <CodeBlock code={HARNESS} language="bash" />
        <p className="text-sm text-muted-foreground">A <code>npx notonq mcp</code> wrapper with the same tool names is on the way.</p>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Rules it keeps</h2>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>Your keys are forwarded per request and never stored. Demand is counted against a salted hash.</li>
          <li>Qloo responses are cached per key only, never shared between callers. The open-data fallback is shared.</li>
          <li>No taste numbers are invented: affinity, heatmaps and demographics come from Qloo, for the stand-ins.</li>
          <li>Last.fm data needs your own Last.fm key (non-commercial use, credited).</li>
        </ul>
      </div>
    </section>
  );
}
