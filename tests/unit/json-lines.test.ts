import { describe, expect, it } from "vitest";
import { jsonLines } from "@/lib/json-lines";

const mixed = {
  results: [
    { entity_id: "[redacted uuid]", name: "[redacted string]", tags: [{ tag_id: "[redacted string]" }] },
    { entity_id: "4588e89e-c107-4025-97d2-ac4070a4ecd0", name: "ANORAK!", properties: { short_description: "Not in Qloo: filled by NotOnQ from open sources." } },
    {
      entity_id: "[redacted uuid]",
      name: "[redacted string]",
      properties: { short_description: "Matched by NotOnQ: Qloo has this artist…", external: { wikidata: "[redacted string]", "notonq:musicbrainz": { id: "x" } }, "notonq:home": { name: "Osaka" } },
      tags: [{ tag_id: "notonq:urn:tag:genre:emo", name: "emo" }],
    },
  ],
  empty: [],
  notonq: { served_by: "mixed", gap: { kind: "G1" } },
};

describe("jsonLines", () => {
  it("prints exactly what JSON.stringify(v, null, 2) prints", () => {
    expect(jsonLines(mixed).map((l) => l.text).join("\n")).toBe(JSON.stringify(mixed, null, 2));
    expect(jsonLines({ a: undefined, b: [1, null, "x"], c: {} }).map((l) => l.text).join("\n")).toBe(JSON.stringify({ a: undefined, b: [1, null, "x"], c: {} }, null, 2));
  });

  it("marks NotOnQ's lines and leaves Qloo's", () => {
    const lines = jsonLines(mixed);
    const ours = (needle: string) => lines.filter((l) => l.text.includes(needle)).map((l) => l.ours);
    expect(ours('"name": "ANORAK!"')).toEqual([true]);
    expect(ours('"short_description": "Matched by NotOnQ')).toEqual([true]);
    expect(ours('"notonq:musicbrainz"')).toEqual([true]);
    expect(ours('"notonq:home"')).toEqual([true]);
    expect(ours('"tag_id": "notonq:urn:tag:genre:emo"')).toEqual([true]);
    expect(ours('"served_by": "mixed"')).toEqual([true]);
    expect(ours('"wikidata"')).toEqual([false]);
    expect(ours('"tag_id": "[redacted string]"')).toEqual([false]);
    expect(ours('"results": [')).toEqual([false]);
    expect(ours('"empty": []')).toEqual([false]);
    // Qloo's first entity: every line of it is Qloo's.
    expect(lines.slice(2, 9).every((l) => !l.ours)).toBe(true);
  });
});
