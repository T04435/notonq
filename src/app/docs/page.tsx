import { A, C, CodeTabs, DocsSection, Notice, P, RefTable, Ul } from "@/components/docs";
import { DocsCode } from "@/components/code";
import { ShapeDiff } from "@/components/shape-diff";

export const metadata = { title: "Docs · NotOnQ" };

const HARNESS = `# The official Qloo MCP server (@qloo/qloo-harness), unchanged. Only its base URL points at NotOnQ.
QLOO_API_KEY=<your Qloo key> \\
QLOO_BASE_URL=https://notonq.vercel.app/q/app/my-app \\
QLOO_TRUSTED_BASE_URL=https://notonq.vercel.app/q/app/my-app \\
qloo mcp`;

const REST = `# Same paths and parameters as the Qloo API: change the base URL, keep your key.
curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-NotOnQ-App: my-app" \\
  "https://notonq.vercel.app/q/search?types=urn:entity:artist&query=sombr"`;

const TRACE = `# One user action in your app, three calls: one visit in the Ledger
curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-NotOnQ-App: my-app" -H "X-NotOnQ-Trace: action-42" \\
  "https://notonq.vercel.app/q/search?types=urn:entity:artist&query=sombr"
curl -H "X-Api-Key: $QLOO_API_KEY" -H "X-NotOnQ-App: my-app" -H "X-NotOnQ-Trace: action-42" \\
  "https://notonq.vercel.app/q/v2/insights?filter.type=urn:entity:artist&signal.interests.entities=502cf908-…"`;

export default function DocsOverview() {
  return (
    <>
      <h1 className="sr-only">NotOnQ docs: overview</h1>
      <Notice lead="Artists only.">
        NotOnQ fills in music artists (<C>urn:entity:artist</C>); every other entity type, and every request Qloo answers, goes to Qloo and comes back
        unchanged.
      </Notice>

      <DocsSection id="quickstart" title="Quickstart">
        <P>
          Change one base URL. Qloo answers first, with your own key. When it has no artist by that name, NotOnQ fills one in from open sources, after
          Qloo&apos;s results, and never removes or reorders anything Qloo returned.
        </P>
        <CodeTabs
          label="Ways in"
          tabs={[
            {
              value: "harness",
              label: "Qloo harness",
              code: HARNESS,
              language: "bash",
              title: "Two environment variables, no new install",
              after: (
                <P>
                  Both variables are needed: the harness only sends your key to a base URL you have marked as trusted. <C>my-app</C> is your
                  app&apos;s name in the Ledger; leave out <C>/app/my-app</C> to stay unlabelled. Same tools, same results; see <A href="/docs/mcp">MCP</A>{" "}
                  for what changes.
                </P>
              ),
            },
            {
              value: "rest",
              label: "REST",
              code: REST,
              language: "bash",
              title: "One base URL",
              after: (
                <P>
                  Every path, parameter and header is in the <A href="/docs/rest">REST API</A> reference.
                </P>
              ),
            },
          ]}
        />
      </DocsSection>

      <DocsSection id="when" title="When NotOnQ fills in">
        <RefTable
          head={["case", "what NotOnQ does", "how Qloo shows it"]}
          rows={[
            ["New to Qloo (G1)", "Adds the artist after Qloo's results, filled in from open sources; or every artist the name could be, when it is ambiguous.", "/search has no artist with that exact name"],
            ["Not yet a taste signal (G2)", "Answers through stand-ins: similar artists Qloo knows.", "/search finds the artist, but /v2/insights answers 400 for it as a signal"],
            ["A short era list (G4)", "Adds artists from that decade or genre and country after Qloo's own; the ones Qloo knows come back as Qloo's entities.", "/v2/insights for artists by a music genre tag and place returns fewer than 5"],
            ["Qloo answers", "Steps aside: Qloo's response passes through unchanged.", "Qloo answers"],
          ]}
        />
      </DocsSection>

      <DocsSection id="shape" title="Same shape as Qloo">
        <P>
          A filled-in artist has exactly the keys and types Qloo returns, so any Qloo client reads it. Its entity ID is a UUID like Qloo&apos;s (the
          MusicBrainz ID, or a stable ID NotOnQ makes), and works anywhere Qloo takes an ID: send it back as a signal and NotOnQ swaps in its stand-ins.
        </P>
        <P>
          <C>properties.short_description</C> starts with <C>Not in Qloo: filled by NotOnQ from open sources.</C> and names the first three stand-ins. All
          of them are listed as data in <C>properties[&quot;notonq:standIns&quot;]</C> (<C>[{"{ entity_id, name }"}]</C>, absent when there are none), so
          read them from there rather than parsing the text. Genre tag IDs and keys Qloo doesn&apos;t have start with <C>notonq:</C>. Qloo&apos;s own values are never changed.
        </P>
        <ShapeDiff />
      </DocsSection>

      <DocsSection id="field-gaps" title="Fields Qloo leaves empty">
        <P>
          When Qloo has the artist but its record lacks a field, NotOnQ adds it beside Qloo&apos;s values, never over them: where the artist is
          from (<C>notonq:home</C>), the languages of their releases (<C>notonq:languages</C>), MusicBrainz and Wikidata IDs, and genres when
          Qloo lists none. An empty audience is answered with Qloo&apos;s audience for the artist&apos;s own genres, labelled. Each value is cited,
          and a name several artists share gets nothing rather than a guess.
        </P>
      </DocsSection>
      <DocsSection id="sources" title="A source on every value">
        <P>
          The <C>notonq.provenance</C> block maps each field to its sources: source, record URL, licence, retrieval time and method. A field with no
          provable source is listed in <C>notonq.unavailable</C> instead of guessed.
        </P>
        <RefTable
          head={["method", "means"]}
          rows={[
            ["copied", "Taken as-is from the cited record (MusicBrainz, Wikidata, Wikipedia, Last.fm, Deezer)."],
            ["derived", "Computed by NotOnQ from cited inputs, with the formula in the note (popularity)."],
            ["qloo_proxy", "Qloo's own answer, for the stand-ins listed."],
            ["researched", "Found by the research agent; the exact quote was re-checked on the cited page by plain code."],
          ]}
        />
      </DocsSection>

      <DocsSection id="ask" title="Ask">
        <P>
          <A href="/">Ask</A> is the home page. A question runs through Qloo&apos;s own MCP harness, and Qloo answers first, unchanged. Jev, the judge,
          checks that answer against what the question asks for, per constraint and per artist. If it falls short, NotOnQ asks Qloo again, then fills
          in the rest from open sources, labelled, with a source on each value. Last, Jev checks whether NotOnQ&apos;s answer adds anything to
          Qloo&apos;s; if not, Qloo&apos;s answer stands. The answer ends with a table of every artist: where it came from,
          kept or removed and why, and what NotOnQ added.
        </P>
      </DocsSection>

      <DocsSection id="ledger" title="The Ledger">
        <P>
          The <A href="/ledger">Ledger</A> is the record: every call through <C>/q</C> and every Ask question. Calls are grouped into visits: calls
          from the same app and caller less than 2 minutes apart, or calls that share an <C>X-NotOnQ-Trace</C> header. Each Ask question is a visit
          of its own.
        </P>
        <Ul>
          <li>Three views: where we filled in, Qloo alone, and all. Filter by app and by kind (API or Ask).</li>
          <li>
            It is live through Neon Realtime, with no polling: new visits arrive at the top. Pause holds the view still and counts the{" "}
            <C>N new</C> waiting.
          </li>
          <li>Every view and filter is in the URL, so a link opens exactly what you see.</li>
          <li>
            A visit opens to its calls. Replay steps through a call with its recorded results, without re-running anything. It is there only where
            NotOnQ answered: when Qloo answered alone, the Ledger keeps the request and a one-line summary, not the response.
          </li>
          <li>
            Each artist NotOnQ has filled in has a record page at <C>/ledger/&lt;name&gt;</C>: what is stored, where the demand came from, and every
            research claim with its verdict.
          </li>
        </Ul>
        <DocsCode code={TRACE} language="bash" title="Group calls into one visit" />
      </DocsSection>

      <DocsSection id="proof" title="Proof">
        <P>
          Every number on <A href="/proof">Proof</A> is counted from runs in the Ledger, across all apps or filtered to one (
          <C>/proof?app=&lt;label&gt;</C>). It refreshes every few seconds while the tab is open.
        </P>
        <P>
          The benchmark batch (<C>scripts/benchmark.mts</C>) is one more app, labelled <C>benchmark</C>: real Ask questions and <C>/q</C> calls sent
          to a running NotOnQ, recorded like any other. Nothing is frozen in the repo; pick the app <C>benchmark</C> on Proof to see that batch alone.
        </P>
      </DocsSection>

      <DocsSection id="redaction" title="Qloo's data on our pages">
        <P>
          Our pages show results derived from Qloo (artist names, links, the agent&apos;s answer, the final table) and never Qloo&apos;s raw API
          responses. On Ask, in the Ledger and in every replay, raw response JSON is redacted on the server before anything reaches a browser or is
          stored: each Qloo value becomes <C>[redacted string]</C>, <C>[redacted uuid]</C>, <C>[redacted number]</C> or <C>[redacted boolean]</C>,
          keeping the shape. Qloo entity IDs are removed everywhere. NotOnQ&apos;s own data is shown in full.
        </P>
        <P>The drop-in API is different: a caller gets Qloo&apos;s answer for their own key, unchanged, exactly as from Qloo.</P>
      </DocsSection>

      <DocsSection id="caching" title="Caching and budgets">
        <Ul>
          <li>Fills are open data, so they are shared: filled-in artists refresh weekly; misses and fills with a failed source retry after a day.</li>
          <li>Qloo responses are cached per caller key only, never shared between callers.</li>
          <li>
            Each call is recorded against a salted hash of your key and your app label (<C>/q/app/&lt;label&gt;</C> or <C>X-NotOnQ-App</C>). Keys
            are never stored.
          </li>
          <li>Each caller has a daily budget of real Qloo calls (default 1500; cache hits are free). Over it, NotOnQ answers 429 until 00:00 UTC.</li>
        </Ul>
      </DocsSection>

      <DocsSection id="inside-qloo" title="Inside Qloo">
        <P>
          NotOnQ shows the behaviour, not the data pipeline. The open sources it uses (MusicBrainz, Wikidata, Wikipedia, Last.fm, Deezer) stand in for
          whatever Qloo would use. Built into Qloo, the same flow would run on Qloo&apos;s own licensed sources and taste graph: fill in the artist,
          label it, answer taste questions through similar artists, and step aside once the artist is in the catalogue. The <A href="/ledger">Ledger</A>{" "}
          shows which of the artists we filled in people actually ask for. Artists first; the same pattern fits other entity types.
        </P>
      </DocsSection>

      <DocsSection id="limits" title="Known limits">
        <Ul>
          <li>
            <C>/v2/trending</C> has no fill yet, so Qloo&apos;s answer passes through (it has had no data since about May 2026).
          </li>
          <li>An artist with no similar artist Qloo knows gets an empty taste answer (its label says why), never a guess.</li>
          <li>Research needs an AI Gateway credential on the host; without one the research step reports that it is off.</li>
        </Ul>
      </DocsSection>
    </>
  );
}
