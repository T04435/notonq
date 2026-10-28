import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";

// One artist response side by side: Qloo's on the left, NotOnQ's on the right. A row is [left, right]; null means the
// line exists on one side only. Lines that differ are amber on NotOnQ's side; the rest are identical.
type Side = string | null;
const SPLIT: [left: Side, right: Side][] = [
  ["{", "{"],
  ['  "results": [{', '  "results": [{'],
  ['    "entity_id": "B8BEE72B-…",', '    "entity_id": "502cf908-…",'],
  ['    "name": "sombr",', '    "name": "sombr",'],
  ['    "types": ["urn:entity:artist"],', '    "types": ["urn:entity:artist"],'],
  ['    "tags": [{', '    "tags": [{'],
  ['      "tag_id": "urn:tag:genre:pop",', '      "tag_id": "notonq:urn:tag:genre:pop",'],
  ['      "type": "urn:tag:genre"', '      "type": "urn:tag:genre"'],
  ["    }],", "    }],"],
  ['    "properties": {', '    "properties": {'],
  ['      "short_description": "American singer…",', '      "short_description": "Not in Qloo: filled by NotOnQ from open sources. … American singer…",'],
  ['      "external": {', '      "external": {'],
  ['      "lastfm": { "id", "listeners" },', '      "lastfm": { "id", "listeners" },'],
  [null, '      "notonq:deezer": { "id", "fans" }'],
  ["    } },", "    } },"],
  ["  }],", "  }],"],
  [null, '  "notonq": { "served_by", "provenance", … }'],
  ["}", "}"],
];

/** Qloo's artist response beside NotOnQ's fill, one row per line, in a single core Code Block styled as the docs
 * code box: what NotOnQ changes or adds is in amber on its side; everything else is identical. */
export function ShapeDiff() {
  // One box: the code grid gets two columns, so each row is Qloo's line beside NotOnQ's.
  return (
    <CodeBlock className="border-border bg-surface dark:bg-surface">
      <CodeBlockHeader className="gap-3 border-b px-3.5 py-2 pt-2 text-xs">
        <CodeBlockTitle className="text-xs font-normal text-muted-foreground">Qloo&apos;s artist (left) beside NotOnQ&apos;s fill (right)</CodeBlockTitle>
        <span className="ms-auto shrink-0 text-muted-foreground">json</span>
      </CodeBlockHeader>
      <CodeBlockContent className="p-3.5 pt-3.5! text-[12.5px] leading-[1.75] text-foreground [&>code]:grid-cols-[max-content_max-content] [&>code]:gap-x-10">
        {SPLIT.flatMap((row, i) =>
          ([0, 1] as const).map((side) => {
            const line = row[side];
            const ours = side === 1 && line !== null && row[0] !== row[1];
            return (
              <CodeBlockLine key={`${i}-${side}`} className={ours ? "text-fill" : undefined}>
                {line ?? ""}
              </CodeBlockLine>
            );
          }),
        )}
      </CodeBlockContent>
    </CodeBlock>
  );
}
