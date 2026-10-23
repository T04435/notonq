import { Code } from "@/components/code";
import { SimpleTable } from "@/components/simple-table";

export const metadata = { title: "MCP · NotOnQ" };

const CONFIG = `{
  "mcpServers": {
    "notonq": {
      "command": "npx",
      "args": ["-y", "notonq", "mcp"],
      "env": {
        "QLOO_API_KEY": "<your Qloo key>",
        "NOTONQ_URL": "https://<notonq-host>",
        "NOTONQ_APP": "my-app"
      }
    }
  }
}`;

const FLOW = `qloo_describe { "entity": "victoria queen", "type": "artist" }
→ status: "needs_input", notonq_candidates: [{ "key": "lf:victoria-queen", … }, …]

notonq_fill { "name": "victoria queen", "candidate": "lf:victoria-queen" }
→ status: "partial", results: [{ "entity_id": "notonq:dz:12775769", … }]

qloo_recommend { "target_type": "artist", "signals": ["sombr"] }
→ status: "partial", warnings: ["… "sombr" → The Neighbourhood, Harry Styles, Wallows, …"]`;

export default function McpReference() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Install</h2>
        <p className="text-sm text-muted-foreground">
          <code>notonq mcp</code> runs the official Qloo MCP server (<code>@qloo/qloo-harness</code>, unchanged) with NotOnQ behind it, through a
          loopback-only proxy. Same tools, same names, same result envelope. Node 22.19 or later.
        </p>
        <Code code={CONFIG} language="json" title="MCP client configuration" />
        <SimpleTable
          head={["Variable", "Required", "Use"]}
          mono={[0]}
          rows={[
            ["QLOO_API_KEY", "yes", "Your Qloo key, forwarded per request, never stored"],
            ["NOTONQ_URL", "no", "The NotOnQ host (default http://localhost:3400)"],
            ["NOTONQ_APP", "no", "Your app's label in the Ledger and on Proof"],
            ["LASTFM_API_KEY", "no", "Your own Last.fm key, if you want Last.fm data under your key"],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Statuses NotOnQ adds</h2>
        <SimpleTable
          head={["status", "Means"]}
          mono={[0]}
          rows={[
            ["partial", "Some of the result is NotOnQ's (a filled artist, or Qloo's answer for stand-ins). A warning names the stand-ins; notonq_provenance gives the sources."],
            ["needs_input", "The artist name is ambiguous. notonq_candidates lists the options: ask the person, or pick from context, then call notonq_fill."],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Tools</h2>
        <SimpleTable
          head={["Tool", "With NotOnQ", "Checked"]}
          mono={[0]}
          rows={[
            ["qloo_describe", "An artist Qloo lacks comes back filled (partial), or needs_input with candidates.", "end to end"],
            ["qloo_recommend", "Signals Qloo can't use become stand-ins (partial). Exact names Qloo knows are passed as Qloo IDs, so it answers where the plain harness asks which one.", "end to end"],
            ["qloo_rank", "Signals swapped like recommend; the options being ranked are left alone.", "end to end"],
            ["qloo_compare_audiences", "group_a and group_b swapped like signals.", "end to end"],
            ["qloo_where_popular", "Heatmap of the stand-ins, labelled partial.", "end to end"],
            ["qloo_audience_demographics", "Age and gender skew of the stand-ins, labelled partial.", "end to end"],
            ["qloo_entity_tags", "Tags of the stand-ins, labelled partial. (The harness returns broad tags across types even for artists Qloo knows.)", "end to end"],
            ["qloo_trends", "Passes through; Qloo has had no trend data since about May 2026.", "end to end"],
            ["qloo_capabilities, qloo_find_tags", "Unchanged.", "pass-through"],
            ["notonq_candidates", "Every artist a name could be, across MusicBrainz, Last.fm and Deezer, flagged when Qloo already knows one.", "end to end"],
            ["notonq_fill", "Fill from one candidate key: a Qloo-shaped entity with a notonq: ID, usable as a signal.", "end to end"],
            ["notonq_provenance", "Source, record, licence and method for every value of a notonq: entity, plus its stand-ins.", "end to end"],
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">A typical exchange</h2>
        <Code code={FLOW} language="bash" title="Agent calls" />
      </section>
    </div>
  );
}
