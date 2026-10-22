import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import proof from "@/data/proof.json";

export const metadata = { title: "Proof · NotOnQ" };

const pct = (v: number) => `${v}%`;

export default function ProofPage() {
  const { coverage, fill, backtest, method } = proof;
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Proof</h1>
        <p className="text-muted-foreground">
          One measured run, {new Date(proof.ranAt).toUTCString()}: how often Qloo can&apos;t use an artist, how much NotOnQ fills, and how close the
          stand-in answer gets to Qloo&apos;s own. Counts and percentages only; the run used {method.qlooCalls} Qloo calls.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>New artists Qloo can&apos;t use</CardDescription>
            <CardTitle className="text-3xl">{pct(coverage.fresh.gapRatePct)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            of {coverage.fresh.artists} artists with a release in the last 14 days, vs {pct(coverage.chart.gapRatePct)} of the top {coverage.chart.artists}{" "}
            chart artists
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Gaps NotOnQ fills</CardDescription>
            <CardTitle className="text-3xl">{pct(fill.entityPct)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            of {fill.artists} gap artists get a sourced entity; {pct(fill.standInsPct)} also get stand-ins Qloo can answer for
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Stand-ins vs Qloo&apos;s own answer</CardDescription>
            <CardTitle className="text-3xl">{pct(Math.round(backtest.meanOverlapAt20 * 1000) / 10)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            of Qloo&apos;s top 20 &quot;fans also like&quot; recovered from stand-ins alone ({pct(Math.round(backtest.meanOverlapAt10 * 1000) / 10)} of the top 10),{" "}
            {backtest.artists} artists
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Coverage</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sample</TableHead>
              <TableHead className="text-right">Artists</TableHead>
              <TableHead className="text-right">Usable in Qloo</TableHead>
              <TableHead className="text-right">Unknown (G1)</TableHead>
              <TableHead className="text-right">Not in taste graph (G2)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(["fresh", "chart"] as const).map((s) => (
              <TableRow key={s}>
                <TableCell className="whitespace-normal">{method.samples[s]}</TableCell>
                <TableCell className="text-right">{coverage[s].artists}</TableCell>
                <TableCell className="text-right">{coverage[s].usableInQloo}</TableCell>
                <TableCell className="text-right">{coverage[s].unknownG1}</TableCell>
                <TableCell className="text-right">{coverage[s].notInTasteGraphG2}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">What the fill contains</h2>
        <p className="text-sm text-muted-foreground">{method.fill}. Average {fill.meanSourcedFields} cited fields per artist.</p>
        <Table>
          <TableBody>
            {[
              ["Entity with sourced identity", fill.entityPct],
              ["Stand-ins Qloo can answer for", fill.standInsPct],
              ["Derived popularity", fill.popularityPct],
              ["Genres", fill.genresPct],
              ["Description", fill.descriptionPct],
              ["Image", fill.imagePct],
            ].map(([label, v]) => (
              <TableRow key={label}>
                <TableCell>{label}</TableCell>
                <TableCell className="text-right">{pct(v as number)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-sm text-muted-foreground">
          Descriptions and images are the open-data weak spot for new artists; the research agent (tier 3) targets exactly those, with every quote
          checked on its page.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-medium">Method</h2>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>{method.gap}</li>
          <li>{method.backtest}.</li>
          <li>Rerun with <code>node --import tsx scripts/proof.mts</code> (your own Qloo and Last.fm keys).</li>
        </ul>
      </div>
    </section>
  );
}
