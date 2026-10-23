import { CodeBlock, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block";

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

/** Qloo's artist response beside NotOnQ's fallback, one row per line, in a single core Code Block. */
export function ShapeDiff() {
  // One box: the code grid gets two columns, so each row is Qloo's line beside NotOnQ's (restyled via classes).
  return (
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
  );
}
