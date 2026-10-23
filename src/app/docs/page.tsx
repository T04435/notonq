import Link from "next/link";
import { Code } from "@/components/code";
import { ShapeDiff } from "@/components/shape-diff";
import { SimpleTable } from "@/components/simple-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const metadata = { title: "Docs · NotOnQ" };

const HARNESS = `# The official Qloo MCP server (@qloo/qloo-harness), unchanged. Only its base URL points at NotOnQ:
QLOO_API_KEY=<your Qloo key> \\
QLOO_BASE_URL=https://<notonq-host>/q/app/my-app \\
QLOO_TRUSTED_BASE_URL=https://<notonq-host>/q/app/my-app \\
qloo mcp`;

const REST = `# Same paths and parameters as the Qloo API: change the base URL, keep your key.
curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-NotOnQ-App: my-app" \\
  "https://<notonq-host>/q/search?types=urn:entity:artist&query=sombr"`;

export default function DocsOverview() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Quickstart</h2>
        <p className="text-sm text-muted-foreground">
          Change one base URL. Qloo always answers first with your own key; NotOnQ only adds to the response when Qloo has a gap for an artist, and
          never removes or reorders anything Qloo returned.
        </p>
        <Tabs defaultValue="harness">
          <TabsList>
            <TabsTrigger value="harness">Qloo harness</TabsTrigger>
            <TabsTrigger value="rest">REST</TabsTrigger>
          </TabsList>
          <TabsContent value="harness" className="flex flex-col gap-2">
            <Code code={HARNESS} language="bash" title="Two environment variables, no new install" />
            <p className="text-sm text-muted-foreground">
              Both variables are needed: the harness only sends your key to a base URL you have marked as trusted (true for Qloo&apos;s own hackathon host
              as well). <code>my-app</code> is your app&apos;s name in the Ledger; leave out <code>/app/my-app</code> to stay unlabelled. Same tools, same
              results; see <Link href="/docs/mcp" className="underline">MCP</Link> for what changes.
            </p>
          </TabsContent>
          <TabsContent value="rest">
            <Code code={REST} language="bash" title="One base URL" />
          </TabsContent>
        </Tabs>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">When NotOnQ steps in</h2>
        <SimpleTable
          head={["Gap", "How Qloo shows it", "What NotOnQ does"]}
          rows={[
            ["Unknown (G1)", "/search has no artist with the exact name (404 or other names only)", "Adds the artist after Qloo's results, filled from open data, or every artist the name could be when it is ambiguous"],
            ["Not in the taste graph (G2)", "Search finds it, but /v2/insights answers 400 for it as a signal", "Swaps it for stand-ins: similar artists Qloo does know"],
            ["None", "Qloo answers", "Steps aside: Qloo's response passes through unchanged"],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Same shape as Qloo, 1:1</h2>
        <p className="text-sm text-muted-foreground">
          A filled artist has exactly the keys and types Qloo returns. Its entity ID is a UUID like Qloo&apos;s (the MusicBrainz ID, or a stable ID NotOnQ
          makes), so any Qloo client can send it back; <code>properties.short_description</code> starts with &quot;Not in Qloo&quot; and names the stand-ins.
          Genre tag IDs and keys Qloo doesn&apos;t have start with <code>notonq:</code>. Qloo&apos;s own values are never changed. Send a NotOnQ ID back as a
          signal and NotOnQ swaps in its stand-ins.
        </p>
        <ShapeDiff />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Every value has proof</h2>
        <p className="text-sm text-muted-foreground">
          The <code>notonq.provenance</code> block maps each field to its sources: source, record URL, licence, retrieval time and method.
        </p>
        <SimpleTable
          head={["method", "Means"]}
          mono={[0]}
          rows={[
            ["copied", "Taken as-is from the cited record (MusicBrainz, Wikidata, Wikipedia, Last.fm, Deezer)"],
            ["derived", "Computed by NotOnQ from cited inputs, with the formula in the note (popularity)"],
            ["qloo_proxy", "Qloo's own answer, for the stand-ins listed"],
            ["researched", "Found by the research agent; the exact quote was re-checked on the cited page by plain code"],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Caching, demand and budgets</h2>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>Fallbacks are open data, so they are shared: filled artists refresh weekly, misses and fills with a failed source retry after a day.</li>
          <li>Qloo responses are cached per caller key only, never shared between callers.</li>
          <li>
            Every artist lookup counts towards the <Link href="/ledger" className="underline">Ledger</Link>, against a salted hash of your key and your app
            label (<code>/q/app/&lt;label&gt;</code> or <code>X-NotOnQ-App</code>). Keys are never stored.
          </li>
          <li>Each caller has a daily budget of real Qloo calls (default 1500; cache hits are free). Over it, NotOnQ answers 429 until 00:00 UTC.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Known limits</h2>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>Artists only. Other entity types pass through to Qloo.</li>
          <li>/v2/trending: no fallback series yet, so Qloo&apos;s answer passes through (it has had no data since about May 2026).</li>
          <li>An artist with no similar artist Qloo knows gets an empty taste answer (its label says why), never a guess.</li>
          <li>Research needs an AI Gateway credential on the host; without one the Research step reports it is off.</li>
        </ul>
      </section>
    </div>
  );
}
