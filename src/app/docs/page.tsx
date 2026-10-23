import { Code } from "@/components/code";
import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";

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

// One artist response side by side: Qloo's on the left, NotOnQ's on the right. A row is [left, right]; null means the
// line exists on one side only. Changed lines are marked removed (left) and added (right); the rest are identical.
type Side = string | null;
const SPLIT: [left: Side, right: Side][] = [
  ["{", "{"],
  ['  "results": [{', '  "results": [{'],
  ['    "entity_id": "B8BEE72B-…",', '    "entity_id": "notonq:mbid:502cf908-…",'],
  ['    "name": "sombr",', '    "name": "sombr",'],
  ['    "types": ["urn:entity:artist"],', '    "types": ["urn:entity:artist"],'],
  ['    "tags": [{', '    "tags": [{'],
  ['      "tag_id": "urn:tag:genre:pop",', '      "tag_id": "notonq:urn:tag:genre:pop",'],
  ['      "type": "urn:tag:genre"', '      "type": "urn:tag:genre"'],
  ["    }],", "    }],"],
  ['    "properties": { "external": {', '    "properties": { "external": {'],
  ['      "lastfm": { "id", "listeners" },', '      "lastfm": { "id", "listeners" },'],
  [null, '      "notonq:deezer": { "id", "fans" }'],
  ["    } }", "    } }"],
  ["  }],", "  }],"],
  [null, '  "notonq": { "served_by", "provenance", … }'],
  ["}", "}"],
];

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
        <Code code={REST} language="bash" title="Drop-in REST" />
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Same shape as Qloo, 1:1</h2>
        <p className="text-sm text-muted-foreground">
          A filled artist has exactly the keys and types Qloo returns for an artist. Anything that is NotOnQ&apos;s rather than Qloo&apos;s starts with{" "}
          <code>notonq:</code>: entity IDs (<code>notonq:mbid:…</code>, <code>notonq:dz:…</code>), genre tag IDs (<code>notonq:urn:tag:genre:folk</code>) and
          keys Qloo doesn&apos;t have (<code>properties.external[&quot;notonq:deezer&quot;]</code>). Send a <code>notonq:</code> entity ID back as a signal and
          NotOnQ swaps in its stand-ins. Qloo&apos;s own values are never prefixed or changed.
        </p>
        {/* One box: the code grid gets two columns, so each row is Qloo's line beside NotOnQ's (restyled via classes). */}
        <CodeBlock size="sm">
          <CodeBlockHeader className="grid grid-cols-2 gap-x-6">
            <CodeBlockTitle>Qloo</CodeBlockTitle>
            <CodeBlockTitle>NotOnQ fallback</CodeBlockTitle>
          </CodeBlockHeader>
          <CodeBlockContent className="[&>code]:grid-cols-2 [&>code]:gap-x-6">
            {SPLIT.flatMap((row, i) =>
              ([0, 1] as const).map((side) => {
                const line = row[side];
                const changed = row[0] !== row[1];
                return (
                  <CodeBlockLine key={`${i}-${side}`} variant={line === null || !changed ? "default" : side === 0 ? "removed" : "added"}>
                    {line ?? ""}
                  </CodeBlockLine>
                );
              }),
            )}
          </CodeBlockContent>
        </CodeBlock>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-medium">With the official Qloo harness</h2>
        <Code code={HARNESS} language="bash" title="Official Qloo harness" />
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
