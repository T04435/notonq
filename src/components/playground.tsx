"use client";

import { CircleCheckIcon, CircleXIcon, DatabaseIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { CodeBlock, CodeBlockCopyButton } from "@/components/ai-elements/code-block";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { CitedValue } from "@/components/cited-value";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { demandText } from "@/lib/demand";
import type { PlaygroundView } from "@/server/playground";
import type { Provenance } from "@/server/provenance";

const EXAMPLES = ["sombr", "Nettspend", "Courtney Barnett"];

export function Playground() {
  const [name, setName] = useState("");
  const [view, setView] = useState<PlaygroundView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  async function run(artist: string) {
    const q = artist.trim();
    if (!q) return;
    setName(q);
    setLoading(q);
    setError(null);
    try {
      const res = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: q }) });
      const body = await res.json().catch(() => ({ error: `The server answered HTTP ${res.status} without details.` }));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setView(body as PlaygroundView);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(name);
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="An artist name, e.g. sombr" aria-label="Artist name" maxLength={100} />
        <Button type="submit" disabled={!!loading}>
          {loading ? <Spinner /> : <SearchIcon />}
          Look up
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Try:
        {EXAMPLES.map((ex) => (
          <Button key={ex} variant="outline" size="sm" disabled={!!loading} onClick={() => void run(ex)}>
            {ex}
          </Button>
        ))}
      </div>

      {error && (
        <Alert variant="destructive">
          <CircleXIcon />
          <AlertTitle>The lookup failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <Trace>
          <TraceLine status="running">
            <TraceIcon>
              <Spinner />
            </TraceIcon>
            <TraceTitle>Asking Qloo about {loading}</TraceTitle>
            <TraceDescription>then open data and stand-ins if Qloo has a gap</TraceDescription>
          </TraceLine>
        </Trace>
      )}

      {!loading && !view && !error && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <DatabaseIcon />
            </EmptyMedia>
            <EmptyTitle>Look up any artist</EmptyTitle>
            <EmptyDescription>Qloo answers first. Where it has nothing, NotOnQ fills the gap and shows where every value came from.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {!loading && view && <Result view={view} />}
    </div>
  );
}

function Result({ view }: { view: PlaygroundView }) {
  const p = view.notonq.provenance ?? {};
  const e = view.entity;
  const ext = e?.properties.external;
  const records = [...new Map(Object.values(p).flat().filter((s) => /^https?:/.test(s.record)).map((s) => [s.record, s])).values()];

  return (
    <div className="flex flex-col gap-6">
      <Trace>
        {view.steps.map((s, i) => (
          <TraceLine key={i} status={s.status} className="items-start">
            <TraceIcon className="mt-0.5">{s.status === "error" ? <CircleXIcon /> : <CircleCheckIcon />}</TraceIcon>
            {/* Details are sentences, so they wrap instead of truncating on narrow screens. */}
            <TraceTitle className="whitespace-normal">
              <span className="font-medium">{s.title}</span> {s.detail}
            </TraceTitle>
          </TraceLine>
        ))}
      </Trace>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Qloo <Badge variant={view.servedBy === "qloo" ? "default" : "destructive"}>{view.qloo.label}</Badge>
            </CardTitle>
            <CardDescription>{view.qloo.summary}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {view.qloo.entityName ? <p>Entity: {view.qloo.entityName}</p> : view.qloo.message ? <p className="font-mono">&quot;{view.qloo.message}&quot;</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              NotOnQ <Badge variant="secondary">{view.notonq.served_by}</Badge>
              {view.notonq.cache?.hit && <Badge variant="outline">cache</Badge>}
            </CardTitle>
            <CardDescription>
              {view.servedBy === "qloo"
                ? "Nothing to fill: Qloo's own data is used as-is."
                : view.notonq.demand
                  ? demandText(view.notonq.demand)
                  : null}
            </CardDescription>
          </CardHeader>
          {e && (
            <CardContent className="flex gap-4">
              {e.properties.image && (
                // eslint-disable-next-line @next/next/no-img-element -- remote Commons image, cited below
                <img src={e.properties.image.url} alt={e.name} className="size-20 shrink-0 rounded-md object-cover" />
              )}
              <div className="text-sm">
                <p className="font-medium">
                  <CitedValue sources={p.name}>{e.name}</CitedValue>
                </p>
                {e.disambiguation && <p className="text-muted-foreground">{e.disambiguation}</p>}
                <p className="font-mono text-xs text-muted-foreground">{e.entity_id}</p>
              </div>
            </CardContent>
          )}
        </Card>
      </div>

      {e && (
        <ItemGroup className="rounded-md border">
          <Field title="Description" sources={p["properties.short_description"]}>
            {e.properties.short_description}
          </Field>
          <Field title="Also known as" sources={p["properties.akas"]}>
            {e.properties.akas?.map((a) => a.value).join(", ")}
          </Field>
          <Field title="Genres" sources={p.tags}>
            {e.tags.map((t) => t.name).join(", ")}
          </Field>
          <Field title="IDs on other services" sources={[...(p["properties.external.musicbrainz"] ?? []), ...(p["properties.external.wikidata"] ?? []), ...(p["properties.external.spotify"] ?? [])]}>
            {[ext?.musicbrainz && `MusicBrainz ${ext.musicbrainz.id}`, ext?.wikidata && `Wikidata ${ext.wikidata.id}`, ext?.spotify && `Spotify ${ext.spotify.id}`].filter(Boolean).join(" · ")}
          </Field>
          <Field title="Last.fm listeners" sources={p["properties.external.lastfm"]}>
            {ext?.lastfm?.listeners?.toLocaleString("en")}
          </Field>
          <Field title="Popularity (derived)" sources={p.popularity}>
            {e.popularity !== undefined && view.notonq.popularity
              ? `${e.popularity} (fitted on ${view.notonq.popularity.n} stand-ins, error ±${view.notonq.popularity.rmse})`
              : undefined}
          </Field>
        </ItemGroup>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Fans also like</CardTitle>
          <CardDescription>
            {view.alsoLike.via === "stand-ins"
              ? `${view.alsoLike.note}: ${view.notonq.proxy?.stand_ins.map((s) => s.name).join(", ")}`
              : view.alsoLike.via === "artist"
                ? "Qloo's own answer"
                : view.alsoLike.note}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {view.alsoLike.names.length ? view.alsoLike.names.map((n) => <Badge key={n} variant="outline">{n}</Badge>) : <span className="text-sm text-muted-foreground">Nothing to show</span>}
        </CardContent>
      </Card>

      {!!view.notonq.unavailable?.length && (
        <Alert>
          <AlertTitle>Not filled (no provable source)</AlertTitle>
          <AlertDescription>{view.notonq.unavailable.join(", ")}</AlertDescription>
        </Alert>
      )}

      {records.length > 0 && (
        <Sources>
          <SourcesTrigger count={records.length} />
          <SourcesContent>
            {records.map((s) => (
              <Source key={s.record} href={s.record} title={`${s.source}: ${s.record.replace(/^https?:\/\//, "")}`} />
            ))}
          </SourcesContent>
        </Sources>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">The same, as a drop-in API call</h2>
        <CodeBlock code={view.dropIn.request} language="bash">
          <CodeBlockCopyButton />
        </CodeBlock>
        <CodeBlock code={JSON.stringify(view.dropIn.response, null, 2)} language="json" className="max-h-96 overflow-auto">
          <CodeBlockCopyButton />
        </CodeBlock>
      </div>
      <p className="text-xs text-muted-foreground">Looked up in {(view.ms / 1000).toFixed(1)} s.</p>
    </div>
  );
}

function Field({ title, sources, children }: { title: string; sources?: Provenance[]; children?: React.ReactNode }) {
  const empty = children === undefined || children === null || children === "";
  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="line-clamp-none">{empty ? "unavailable" : <CitedValue sources={sources}>{children}</CitedValue>}</ItemDescription>
      </ItemContent>
    </Item>
  );
}
