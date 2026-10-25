import { describe, expect, it } from "vitest";
import { ourLabelPart, REDACTED, redactBody, redactQlooIds, redactValue } from "@/server/redact";

// Qloo's own data never reaches our pages or the Ledger: it is redacted on the server by type; NotOnQ's stays in full.
describe("redacting Qloo's data", () => {
  const ours = { entity_id: "502cf908-9921-48bc-bf0e-265c881c0156", name: "sombr", properties: { short_description: "Not in Qloo: filled by NotOnQ…" } };
  const qloo = { entity_id: "4BBEF799-A0C4-4110-AB01-39216993C312", name: "Taylor Swift", popularity: 0.99, properties: { short_description: "American singer." } };
  const picked = {
    entity_id: "679CEADA-31C3-4A06-99D0-D7384D6693BF",
    name: "Fela Kuti",
    properties: { short_description: "Picked by NotOnQ: Qloo returned 0 artists for this request; this is Qloo's own record (MusicBrainz: Nigeria; active from 1938 to 1997). Qloo has 6 artists for this tag as a taste signal (signal.interests.tags). Nigerian multi-instrumentalist." },
  };

  it("replaces every value with its type, keeping the shape", () => {
    expect(redactValue(qloo)).toEqual({ entity_id: REDACTED.uuid, name: REDACTED.string, popularity: REDACTED.number, properties: { short_description: REDACTED.string } });
  });

  it("keeps NotOnQ's fills, keeps a picked record's name and NotOnQ's label only, redacts the rest", () => {
    const body = redactBody({ results: { entities: [qloo, picked, ours] }, query: { explainability: {} }, notonq: { stand_ins: [{ entity_id: qloo.entity_id, name: "The Neighbourhood" }] } }) as {
      results: { entities: { name: string; entity_id: string; properties: { short_description: string } }[] };
      notonq: { stand_ins: { entity_id: string; name: string }[] };
      query: unknown;
    };
    const [q, p, o] = body.results.entities;
    expect(q.name).toBe(REDACTED.string);
    expect(p.name).toBe("Fela Kuti");
    expect(p.entity_id).toBe(REDACTED.uuid);
    expect(p.properties.short_description).not.toContain("multi-instrumentalist");
    expect(p.properties.short_description).toContain("MusicBrainz: Nigeria; active from 1938 to 1997");
    expect(o).toEqual(ours);
    expect(body.notonq.stand_ins[0]).toEqual({ entity_id: REDACTED.uuid, name: "The Neighbourhood" });
    expect(body.query).toEqual({ explainability: {} });
  });

  it("removes Qloo IDs (upper case) but keeps NotOnQ's IDs (lower case)", () => {
    expect(redactQlooIds({ signals: ["4BBEF799-A0C4-4110-AB01-39216993C312", "502cf908-9921-48bc-bf0e-265c881c0156"] })).toEqual({
      signals: [REDACTED.uuid, "502cf908-9921-48bc-bf0e-265c881c0156"],
    });
  });

  it("keeps the ranked-by-Qloo sentence in NotOnQ's label", () => {
    expect(ourLabelPart("Picked by NotOnQ: Qloo returned 0 artists for this request; this is Qloo's own record (MusicBrainz: Nigeria). Ranked by Qloo for this request's taste signal. Nigerian twin sisters.")).toBe(
      "Picked by NotOnQ: Qloo returned 0 artists for this request; this is Qloo's own record (MusicBrainz: Nigeria). Ranked by Qloo for this request's taste signal.",
    );
  });

  it("cuts a picked record's description to NotOnQ's label", () => {
    expect(ourLabelPart(picked.properties.short_description)).toBe(
      "Picked by NotOnQ: Qloo returned 0 artists for this request; this is Qloo's own record (MusicBrainz: Nigeria; active from 1938 to 1997). Qloo has 6 artists for this tag as a taste signal (signal.interests.tags).",
    );
  });
});
