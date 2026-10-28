import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { answerOf } = await import("@/server/agent/ask");

// Synthetic tool results in the shape the Ask engine records (no real Qloo data in the repo).
const wampi = {
  id: "a84c0052-0000-4000-a000-000000000001",
  name: "Wampi",
  label: "not_in_qloo" as const,
  description: "Not in Qloo: filled by NotOnQ from open sources. Taste answers (recommendations, maps, audiences) use similar artists Qloo knows: El Taiger. From La Habana, Cuba (MusicBrainz).",
  facts: ["10,232 Last.fm listeners", "1,997 Deezer fans"],
  sources: [{ source: "MusicBrainz" }, { source: "Deezer" }],
};
const constraints = [
  { kind: "subject_type" as const, value: "fans", check: "" },
  { kind: "named_entity" as const, value: "Wampi", check: "" },
];
const list = "Qloo returned 0 artists for the question; 0 meet it. NotOnQ added 1 artist from open data, labelled, with sources; 0 meet it.";

describe("Ask's answer", () => {
  it("answers a question about an artist's fans with what was found, and says where each part came from", () => {
    const text = answerOf(
      constraints,
      [
        {
          stage: "notonq",
          calls: [
            { tool: "qloo_describe", input: {}, status: "ok", results: [wampi] },
            { tool: "qloo_where_popular", input: {}, status: "ok", results: [{ location: "23.1, -82.4" }, { location: "25.8, -80.2" }], standIns: ["El Taiger"] },
            { tool: "qloo_audience_demographics", input: {}, status: "ok", results: [], standIns: ["El Taiger"] },
          ],
        },
      ],
      list,
    );
    expect(text).toBe(
      "Wampi isn't in Qloo. NotOnQ's record: from La Habana, Cuba; 10,232 Last.fm listeners; 1,997 Deezer fans (MusicBrainz, Deezer). " +
        "No age data for Wampi: Qloo has none for the similar artists it knows (El Taiger) either. " +
        "Where the fans are: 2 areas on Qloo's map (Qloo, through similar artists Qloo knows: El Taiger; via NotOnQ).",
    );
    expect(text).not.toContain("meet it");
  });

  it("never credits an earlier stage's data (another entity Qloo resolved) to the artist asked about", () => {
    const text = answerOf(
      constraints,
      [
        { stage: "qloo", calls: [{ tool: "qloo_audience_demographics", input: {}, status: "ok", results: [{ ages: ["30–34"], gender: "male" }] }] },
        { stage: "notonq", calls: [{ tool: "qloo_describe", input: {}, status: "ok", results: [wampi] }, { tool: "qloo_audience_demographics", input: {}, status: "ok", results: [], standIns: ["El Taiger"] }] },
      ],
      list,
    );
    expect(text).not.toContain("30–34");
    expect(text).toContain("No age data for Wampi");
  });

  it("gives the age skew when Qloo has it", () => {
    const text = answerOf(constraints, [{ stage: "notonq", calls: [{ tool: "qloo_audience_demographics", input: {}, status: "ok", results: [{ ages: ["35–44", "45–54"], gender: "male" }], standIns: ["El Taiger"] }] }], list);
    expect(text).toBe("Fans lean 35–44 and 45–54, male (Qloo, through similar artists Qloo knows: El Taiger; via NotOnQ).");
  });

  it("says when the ages are the audience of the similar artists' genre", () => {
    const text = answerOf(constraints, [{ stage: "notonq", calls: [{ tool: "qloo_audience_demographics", input: {}, status: "ok", results: [{ ages: ["24 and under", "30–34"], gender: "female" }], standIns: ["El Taiger"], genres: ["reggaeton"] }] }], list);
    expect(text).toBe("Fans lean 24 and under and 30–34, female (Qloo's audience for reggaeton, the genre of the similar artists Qloo knows: El Taiger; via NotOnQ).");
  });

  it("keeps the list summary for list questions", () => {
    expect(answerOf([{ kind: "subject_type", value: "artists", check: "" }], [{ stage: "qloo", calls: [{ tool: "qloo_recommend", input: {}, status: "ok", results: [] }] }], list)).toBe(list);
  });
});
