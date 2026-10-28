import { DocsCode } from "@/components/code";
import { A, C, CodeTabs, DocsSection, P, RefTable } from "@/components/docs";

export const metadata = { title: "MCP · NotOnQ" };

const SETUP = `# Install Qloo's MCP server once (or use the one you have)
npm install -g @qloo/qloo-harness

# Run it against NotOnQ: only the base URL changes
QLOO_API_KEY=<your Qloo key> \\
QLOO_BASE_URL=https://notonq.vercel.app/q/app/my-app \\
QLOO_TRUSTED_BASE_URL=https://notonq.vercel.app/q/app/my-app \\
qloo mcp`;

const CONFIG = `{
  "mcpServers": {
    "qloo": {
      "command": "qloo",
      "args": ["mcp"],
      "env": {
        "QLOO_API_KEY": "<your Qloo key>",
        "QLOO_BASE_URL": "https://notonq.vercel.app/q/app/my-app",
        "QLOO_TRUSTED_BASE_URL": "https://notonq.vercel.app/q/app/my-app"
      }
    }
  }
}`;

// Real harness output (trimmed), 23 Oct 2026, base URL pointed at NotOnQ. The descriptions are NotOnQ's (amber).
const FLOW = `// qloo_where_popular { "entity": "sombr", "within": "United States" }
status: "ok"
resolution.selected: { "id": "502cf908-9921-48bc-bf0e-265c881c0156", "name": "sombr", "type": "urn:entity:artist",
  "description": "Not in Qloo: filled by NotOnQ from open sources. Taste answers (recommendations, maps,
                  audiences) use similar artists Qloo knows: The Neighbourhood, Harry Styles, Wallows. …" }
results: [{ "location": { "geohash": "djn1", … }, "query": { "affinity": 1, … } }, …]

// qloo_where_popular { "entity": "Victoria Queen", "within": "United States" }
status: "empty"
resolution.selected: { "id": "e1e3771f-bb8e-5289-b602-5c79b9b67223", "name": "Victoria Queen",
  "description": "Not in Qloo: a possible match NotOnQ found on lastfm, deezer (4 Last.fm listeners, 2 Deezer fans). …" }
alternatives: Qloo's own (Victoria, Queen Victoria Market, …)`;
const FLOW_ADDED = [3, 4, 10];

export default function McpReference() {
  return (
    <>
      <h1 className="sr-only">NotOnQ docs: MCP</h1>

      <DocsSection id="setup" title="Qloo's own MCP server">
        <P>
          NotOnQ runs the official Qloo harness (<C>@qloo/qloo-harness</C>) unchanged, with its base URL pointed at NotOnQ. Same tools, same
          arguments, same result envelope; what changes is the data it gets back. NotOnQ has no MCP server of its own.
        </P>
        <CodeTabs
          label="Run the harness"
          tabs={[
            { value: "terminal", label: "Terminal", code: SETUP, language: "bash", title: "Install once, then run against NotOnQ" },
            { value: "client", label: "MCP client", code: CONFIG, language: "json", title: "Claude Desktop, Cursor or any MCP client" },
          ]}
        />
        <P>
          Both URLs must match: the harness only sends your key to a base URL you have marked as trusted. <C>my-app</C> names your app in the
          Ledger.
        </P>
      </DocsSection>

      <DocsSection id="agent" title="What the agent sees">
        <RefTable
          head={["situation", "what happens"]}
          rows={[
            ["Qloo knows the artist", "Nothing changes: Qloo's entity and answer."],
            [
              "New to Qloo, one artist by that name",
              "The harness picks NotOnQ's entity by exact name. Its description starts \"Not in Qloo: filled by NotOnQ from open sources.\" and names the stand-ins; Qloo's own matches stay as alternatives.",
            ],
            [
              "Several artists share the name",
              "The harness asks which one (status needs_input), listing the real artists with country, listeners and sources. The agent passes the chosen ID back; NotOnQ fills it in.",
            ],
            ["Taste questions", "Recommendations, maps and audiences: Qloo answers for the stand-ins, similar artists Qloo knows."],
            ["No similar artist Qloo knows", "An empty answer (status empty). The label says what the artist is; nothing is guessed."],
          ]}
        />
      </DocsSection>

      <DocsSection id="tools" title="Tools">
        <RefTable
          head={["tool", "with NotOnQ", "checked live (23 Oct)"]}
          rows={[
            ["qloo_describe", "An artist new to Qloo resolves to NotOnQ's entity, labelled.", "sombr"],
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
        <P>
          Sources for every value are on the REST response (<C>notonq.provenance</C>), on <A href="/">Ask</A> and on each filled-in artist&apos;s record
          page, <C>/ledger/&lt;name&gt;</C>.
        </P>
      </DocsSection>

      <DocsSection id="exchange" title="A real exchange">
        <DocsCode code={FLOW} language="harness output" title="Two calls through NotOnQ, trimmed (23 Oct 2026)" added={FLOW_ADDED} />
      </DocsSection>
    </>
  );
}
