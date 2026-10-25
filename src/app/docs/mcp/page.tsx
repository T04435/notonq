import { Code } from "@/components/code";
import { SimpleTable } from "@/components/simple-table";

export const metadata = { title: "MCP · NotOnQ" };

const SETUP = `# Install Qloo's MCP server once (or use the one you have)
npm install -g @qloo/qloo-harness

# Run it against NotOnQ: only the base URL changes
QLOO_API_KEY=<your Qloo key> \\
QLOO_BASE_URL=https://<notonq-host>/q/app/my-app \\
QLOO_TRUSTED_BASE_URL=https://<notonq-host>/q/app/my-app \\
qloo mcp`;

const CONFIG = `{
  "mcpServers": {
    "qloo": {
      "command": "qloo",
      "args": ["mcp"],
      "env": {
        "QLOO_API_KEY": "<your Qloo key>",
        "QLOO_BASE_URL": "https://<notonq-host>/q/app/my-app",
        "QLOO_TRUSTED_BASE_URL": "https://<notonq-host>/q/app/my-app"
      }
    }
  }
}`;

// Real harness output (trimmed), 23 Oct 2026, base URL pointed at NotOnQ.
const FLOW = `qloo_where_popular { "entity": "sombr", "within": "United States" }
→ status: "ok", resolution.selected: {
    "id": "502cf908-9921-48bc-bf0e-265c881c0156", "name": "sombr", "type": "urn:entity:artist",
    "description": "Not in Qloo: filled by NotOnQ from open sources. Taste answers (recommendations, maps,
                    audiences) use similar artists Qloo knows: The Neighbourhood, Harry Styles, Wallows. …" }
  results: [{ "location": { "geohash": "djn1", … }, "query": { "affinity": 1, … } }, …]

qloo_where_popular { "entity": "Victoria Queen", "within": "United States" }
→ status: "empty", resolution.selected: {
    "id": "e1e3771f-bb8e-5289-b602-5c79b9b67223", "name": "Victoria Queen",
    "description": "Not in Qloo: a possible match NotOnQ found on lastfm, deezer (4 Last.fm listeners, 2 Deezer fans). …" }
  alternatives: Qloo's own (Victoria, Queen Victoria Market, …)`;

export default function McpReference() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Use Qloo&apos;s own MCP server</h2>
        <p className="text-sm text-muted-foreground">
          NotOnQ has no MCP server of its own. The official Qloo harness (<code>@qloo/qloo-harness</code>) runs unchanged, with its base URL pointed at
          NotOnQ. Same tools, same arguments, same result envelope; the difference is in the data it gets back.
        </p>
        <Code code={SETUP} language="bash" title="Terminal" />
        <Code code={CONFIG} language="json" title="Claude Desktop, Cursor or any MCP client" />
        <p className="text-sm text-muted-foreground">
          Both URLs must match: the harness only sends your key to a base URL you have marked as trusted. <code>my-app</code> names your app in the Ledger.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">What the agent sees</h2>
        <SimpleTable
          head={["Situation", "What happens"]}
          rows={[
            ["Qloo knows the artist", "Nothing changes: Qloo's entity and answer."],
            ["Qloo doesn't, one artist has that name", "The harness picks NotOnQ's entity by exact name. Its description starts \"Not in Qloo\" and names the stand-ins; Qloo's own matches stay as alternatives."],
            ["Several artists share the name", "The harness asks which one (status needs_input), listing the real artists with country, listeners and sources. The agent passes the chosen ID back; NotOnQ fills it."],
            ["Taste questions (recommend, maps, audiences)", "Qloo answers for the stand-ins, similar artists Qloo knows."],
            ["No similar artist Qloo knows", "An empty answer (status empty). The label says what the artist is; nothing is guessed."],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Tools</h2>
        <SimpleTable
          head={["Tool", "With NotOnQ", "Checked live (23 Oct)"]}
          mono={[0]}
          rows={[
            ["qloo_describe", "An artist Qloo lacks resolves to NotOnQ's entity, labelled.", "sombr"],
            ["qloo_where_popular", "Heatmap of the stand-ins; empty when there are none.", "sombr, Victoria Queen"],
            ["qloo_recommend", "NotOnQ artists as signals become their stand-ins.", "sombr"],
            ["qloo_rank", "Signals swapped; the options being ranked are left alone.", "sombr vs Harry Styles, Wallows"],
            ["qloo_compare_audiences", "A NotOnQ artist in either group becomes its stand-ins.", "sombr vs Harry Styles"],
            ["qloo_audience_demographics", "Age and gender skew of the stand-ins.", "sombr"],
            ["qloo_entity_tags", "Tags of the stand-ins.", "sombr"],
            ["qloo_trends", "Passes through; Qloo has had no trend data since about May 2026.", "not run"],
            ["qloo_capabilities, qloo_find_tags", "Unchanged.", "pass-through"],
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Sources for every value are on the REST response (<code>notonq.provenance</code>), on the Ask page and on each artist&apos;s Ledger page.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">A real exchange</h2>
        <Code code={FLOW} language="bash" title="Harness calls, trimmed" />
      </section>
    </div>
  );
}
