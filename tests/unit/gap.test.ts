import { describe, expect, it } from "vitest";
import type { HttpResult } from "@/server/http";
import { QlooUnavailable, readInsights, readSearch, readTrending, sameName } from "@/server/qloo/gap";
import { qlooArtist } from "./fixtures";

const res = (status: number, json: unknown): HttpResult => ({ status, ok: status >= 200 && status < 300, json, ms: 1, url: "x" });

describe("sameName", () => {
  it("ignores case, accents and punctuation", () => {
    expect(sameName("sombr", "Sombr")).toBe(true);
    expect(sameName("Beyoncé", "beyonce")).toBe(true);
    expect(sameName("Florence + the Machine", "florence the machine")).toBe(true);
    expect(sameName("Sombra", "sombr")).toBe(false);
  });

  it("treats a leading The as optional", () => {
    expect(sameName("Pigram Brothers", "The Pigram Brothers")).toBe(true);
    expect(sameName("the beatles", "Beatles")).toBe(true);
    expect(sameName("The", "the")).toBe(true);
    expect(sameName("Theory", "ory")).toBe(false);
    expect(sameName("The Band", "Band of Horses")).toBe(false);
  });
});

describe("readSearch", () => {
  it("is G1 on a 404 No results", () => {
    const out = readSearch("Nobody", res(404, { message: "No results" }));
    expect(out).toEqual({ gap: expect.objectContaining({ kind: "G1", qlooStatus: 404, qlooMessage: "No results" }) });
  });

  it("is G1 when results have no exact name match", () => {
    const out = readSearch("Sombr", res(200, { results: [qlooArtist(1, "Sombres Forets"), qlooArtist(2, "Sombra")] }));
    expect("gap" in out && out.gap.kind).toBe("G1");
  });

  it("finds the exact match in the live bare-array shape and the documented shape", () => {
    expect(readSearch("Floodlights", res(200, { results: [qlooArtist(3, "Floodlights")] }))).toEqual({ found: expect.objectContaining({ name: "Floodlights" }) });
    expect(readSearch("Floodlights", res(200, { results: { entities: [qlooArtist(3, "Floodlights")] } }))).toHaveProperty("found");
  });

  it("throws on an outage instead of logging a fake gap", () => {
    expect(() => readSearch("x", res(500, { message: "boom" }))).toThrow(QlooUnavailable);
  });
});

describe("readInsights", () => {
  it("is G2 on the not-in-graph 400", () => {
    const gap = readInsights(res(400, { message: "All of the provided signal.interests.entities were invalid" }));
    expect(gap?.kind).toBe("G2");
  });

  it("is G2 on the live errors[] body too", () => {
    const body = { errors: [{ message: "All of the provided signal.interests.entities were invalid. At least one valid signal is required.", path: "signal.interests.entities" }] };
    expect(readInsights(res(400, body))?.kind).toBe("G2");
  });

  it("is null when insights worked", () => {
    expect(readInsights(res(200, { results: { entities: [] } }))).toBeNull();
  });

  it("throws on other errors", () => {
    expect(() => readInsights(res(400, { message: "at least one valid signal or filter is required" }))).toThrow(QlooUnavailable);
  });
});

describe("readTrending", () => {
  it("is G3 when the window has no rows", () => {
    expect(readTrending(res(200, { results: { trending: [] } }))?.kind).toBe("G3");
    expect(readTrending(res(200, { results: { trending: [{ date: "2026-04-13" }] } }))).toBeNull();
  });
});

describe("readSearch with a leading The", () => {
  it("finds Qloo's artist when the query drops The", () => {
    const out = readSearch("Pigram Brothers", res(200, { results: [{ entity_id: "404334C8-646F-45FF-9F67-2F8ADCBF8E47", name: "The Pigram Brothers", types: ["urn:entity:artist"] }] }));
    expect(out).toEqual({ found: expect.objectContaining({ name: "The Pigram Brothers" }) });
  });
});
