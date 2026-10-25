import { describe, expect, it } from "vitest";
import { askRunWithoutQlooData, withoutQlooData } from "@/server/shorten";

// The Ledger's replays are public: Qloo's own results came with a caller's key and must never be stored there.
describe("redacting Qloo's data from stored runs", () => {
  const ours = { entity_id: "a", name: "Tiny Act", properties: { short_description: "Not in Qloo: filled by NotOnQ…" } };
  const qloo = (name: string) => ({ entity_id: name, name, properties: { short_description: "A famous act." } });

  it("keeps NotOnQ's entities in an API response and counts Qloo's", () => {
    expect(withoutQlooData({ results: [qloo("A"), qloo("B"), ours], notonq: { served_by: "mixed" }, query: { x: 1 } })).toEqual({
      results: ["2 Qloo results (not stored: Qloo's data stays with the caller)", ours],
      notonq: { served_by: "mixed" },
    });
    expect(withoutQlooData({ results: { entities: [qloo("A")] } })).toEqual({ results: { entities: ["1 Qloo result (not stored: Qloo's data stays with the caller)"] } });
  });

  it("replaces Qloo's results, tags, answer text and table names in an Ask run, keeping NotOnQ's", () => {
    const run = askRunWithoutQlooData([
      { t: 0, type: "call", column: "qloo", tool: "qloo_find_tags", results: [{ name: "Highlife" }, { name: "Afrobeat" }] },
      { t: 1, type: "call", column: "notonq", tool: "qloo_recommend", results: [{ name: "Femi Kuti" }, { name: "Fela Kuti", label: "picked" }], http: [{ request: "GET /q", json: { results: [qloo("X"), ours] } }] },
      { t: 2, type: "answer", column: "qloo", text: "Carly Rae Jepsen, Katy Perry", source: "qloo" },
      { t: 3, type: "reconcile", rows: [{ origin: "qloo", name: "Katy Perry", link: "https://x" }, { origin: "notonq_added", name: "Tiny Act" }] },
    ]);
    expect(run[0].results).toEqual([{ name: "2 Qloo tags (not stored)" }]);
    expect(run[1].results).toEqual([{ name: "1 Qloo result (not stored)" }, { name: "Fela Kuti", label: "picked" }]);
    expect(JSON.stringify(run[1].http)).not.toContain('"X"');
    expect(run[2].text).not.toContain("Katy Perry");
    expect(run[3].rows).toEqual([
      { origin: "qloo", name: "Qloo result 1 (not stored)", link: undefined, facts: undefined, sources: undefined },
      { origin: "notonq_added", name: "Tiny Act" },
    ]);
  });
});
