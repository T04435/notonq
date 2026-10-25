"use client";

import { CircleCheckIcon, CircleXIcon, UserIcon } from "lucide-react";
import { Code } from "@/components/code";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { NotOnQBadge } from "@/components/brand/notonq-badge";
import { CitedValue } from "@/components/cited-value";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { demandText } from "@/lib/demand";
import type { Candidate } from "@/server/engine/candidates";
import type { PlaygroundView } from "@/server/playground";
import type { Provenance } from "@/server/provenance";

/** One artist's result, as the Ledger's artist page shows it: every field with its sources. */
export function Result({ view, onChoose, onShowAll }: { view: PlaygroundView; onChoose?: (key: string) => void; onShowAll?: () => void }) {
  const p = view.notonq.provenance ?? {};
  const e = view.entity;
  const ext = e?.properties.external;
  const records = [...new Map(Object.values(p).flat().filter((s) => /^https?:/.test(s.record)).map((s) => [s.record, s])).values()];

  return (
    <div className="flex flex-col gap-6">
      <Trace>
        {view.steps.map((s, i) => (
          <TraceLine key={i} status={s.status} className="items-start">
            <TraceIcon className="mt-0.5">{s.status === "error" ? <CircleXIcon /> : s.status === "pending" ? <Spinner /> : <CircleCheckIcon />}</TraceIcon>
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
              NotOnQ{" "}
              {e && view.servedBy !== "needs_choice" ? (
                <NotOnQBadge>Not in Qloo · filled by NotOnQ</NotOnQBadge>
              ) : (
                <Badge variant="secondary">{view.servedBy === "needs_choice" ? "needs your choice" : view.servedBy === "fallback" && !e ? "nothing found yet" : view.notonq.served_by}</Badge>
              )}
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

      {view.servedBy === "needs_choice" && onChoose && <Candidates candidates={view.candidates} onChoose={onChoose} />}

      {e && view.notonq.confidence === "low" && (
        <Alert>
          <AlertTitle>Low confidence</AlertTitle>
          <AlertDescription>No MusicBrainz record: this artist is known only to {[...new Set(Object.values(p).flat().map((s) => s.source))].filter((s) => ["lastfm", "deezer"].includes(s)).join(" and ") || "small sources"}, and was chosen from the matches.</AlertDescription>
        </Alert>
      )}

      {view.servedBy === "fallback" && onShowAll && (
        <Button variant="link" className="w-fit px-0" onClick={onShowAll}>
          Not this artist? See every match
        </Button>
      )}

      {e && (
        <ItemGroup className="rounded-md border">
          <Field title="Description" sources={p["properties.short_description"]}>
            {e.properties.short_description}
          </Field>
          <Field title="Also known as" sources={p["properties.akas"]}>
            {e.properties.akas.map((a) => a.value).join(", ")}
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
          <Field title="Deezer fans" sources={p["properties.external.notonq:deezer"]}>
            {ext?.["notonq:deezer"]?.fans?.toLocaleString("en")}
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
        <Code code={view.dropIn.request} language="bash" title="Request" />
        <Code code={JSON.stringify(view.dropIn.response, null, 2)} language="json" title="Response" className="max-h-96 overflow-auto" />
      </div>
      {view.ms > 0 && <p className="text-xs text-muted-foreground">Looked up in {(view.ms / 1000).toFixed(1)} s.</p>}
    </div>
  );
}

function Candidates({ candidates, onChoose }: { candidates: Candidate[]; onChoose: (key: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Which artist do you mean?</CardTitle>
        <CardDescription>No source has one clear match. Pick one and NotOnQ fills it from that artist&apos;s records.</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup>
          {candidates.map((c) => (
            <Item key={c.key} variant="outline" size="sm">
              <ItemMedia variant="image">
                {c.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- remote source image
                  <img src={c.image} alt="" />
                ) : (
                  <UserIcon />
                )}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {c.name}
                  {c.exact && <Badge variant="secondary">exact name</Badge>}
                  {c.inQloo && <Badge>in Qloo</Badge>}
                </ItemTitle>
                <ItemDescription>
                  {[c.type, c.disambiguation, c.country, c.listeners !== undefined && `${c.listeners.toLocaleString("en")} Last.fm listeners`, c.fans !== undefined && `${c.fans.toLocaleString("en")} Deezer fans`]
                    .filter(Boolean)
                    .join(" · ") || "No details"}
                  {" · "}
                  {c.links.map((l, i) => (
                    <span key={l.url}>
                      {i > 0 && ", "}
                      <a href={l.url} target="_blank" rel="noreferrer" className="underline">
                        {l.source}
                      </a>
                    </span>
                  ))}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button size="sm" variant={c.inQloo ? "secondary" : "default"} onClick={() => onChoose(c.key)}>
                  {c.inQloo ? "Use Qloo's data" : "Use this one"}
                </Button>
              </ItemActions>
            </Item>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
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
