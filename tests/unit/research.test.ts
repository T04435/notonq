import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it } from "vitest";
import { research } from "@/server/research/agent";
import { missingFields } from "@/server/research/apply";
import type { Claim } from "@/server/research/claims";
import { runResearch } from "@/server/research/run";
import { allowedByRobots, pageText, supports, verifyClaims } from "@/server/research/verify";
import { qlooClient } from "@/server/qloo/client";
import { memoryDb, type Sql } from "@/server/store/db";
import { claimsFor, findFallback, saveFallback } from "@/server/store/repo";
import { fakeFetch, json, qid, qlooArtist } from "./fixtures";

const html = (body: string, status = 200) => new Response(`<html><head><script>var x=1</script></head><body>${body}</body></html>`, { status, headers: { "Content-Type": "text/html" } });

const LABEL = "https://label.example/artists/tiny-act";
const REVIEW = "https://zine.example/reviews/tiny-act-ep";
const pages: [string, (u: URL) => Response][] = [
  ["label.example/robots.txt", () => new Response("User-agent: *\nDisallow: /private", { status: 200 })],
  ["zine.example/robots.txt", () => new Response("", { status: 404 })],
  ["blocked.example/robots.txt", () => new Response("User-agent: *\nDisallow: /", { status: 200 })],
  ["label.example/artists/tiny-act", () => html("<p>Tiny Act is a Brisbane dream-pop duo formed in 2023.</p><p>Follow on Instagram @tinyactband</p>")],
  ["zine.example/reviews/tiny-act-ep", () => html("<article>For fans of Bigger Act and Alvvays, this debut EP shimmers. Tiny Act are from Brisbane.</article>")],
  ["blocked.example", () => html("Tiny Act is a Brisbane dream-pop duo formed in 2023.")],
];

const claim = (c: Partial<Claim>): Claim => ({ field: "disambiguation", value: "Brisbane", source_url: LABEL, quote: "Tiny Act is a Brisbane dream-pop duo", ...c });

describe("verifier", () => {
  it("reads visible page text", () => {
    expect(pageText("<script>no</script><p>Hi &amp; bye</p>")).toBe(" Hi & bye ");
  });

  it("checks that the value follows from the quote", () => {
    expect(supports("disambiguation", "Brisbane", "a Brisbane dream-pop duo")).toBe(true);
    expect(supports("disambiguation", "Sydney", "a Brisbane dream-pop duo")).toBe(false);
    expect(supports("properties.short_description", "Tiny Act is a dream-pop duo from Brisbane.", "Tiny Act is a Brisbane dream-pop duo formed in 2023")).toBe(true);
    expect(supports("properties.short_description", "Tiny Act is a Grammy-winning metal band.", "Tiny Act is a Brisbane dream-pop duo")).toBe(false);
    expect(supports("properties.external.instagram", "@tinyactband", "Follow on Instagram @tinyactband")).toBe(true);
  });

  it("respects robots.txt", async () => {
    const { fetch } = fakeFetch(pages);
    expect(await allowedByRobots(new URL("https://label.example/artists/x"), fetch)).toBe(true);
    expect(await allowedByRobots(new URL("https://label.example/private/x"), fetch)).toBe(false);
    expect(await allowedByRobots(new URL("https://zine.example/a"), fetch)).toBe(true);
  });

  it("keeps only claims whose quote is on the page, and rates agreement across sites", async () => {
    const { fetch } = fakeFetch(pages);
    const { verified, rejected } = await verifyClaims(
      [
        claim({}),
        claim({ source_url: REVIEW, quote: "Tiny Act are from Brisbane" }),
        claim({ value: "Sydney", quote: "Tiny Act is a Sydney dream-pop duo" }), // invented quote
        claim({ quote: "Tiny Act is a Brisbane synth-pop trio" }),
        claim({ source_url: "https://blocked.example/x" }),
        claim({ source_url: "https://www.qloo.com/x" }),
        claim({ field: "notonq:similar", value: "Bigger Act", source_url: REVIEW, quote: "For fans of Bigger Act and Alvvays" }),
      ],
      { fetch },
    );
    expect(verified.map((v) => [v.field, v.value, v.confidence])).toEqual([
      ["disambiguation", "Brisbane", "high"],
      ["disambiguation", "Brisbane", "high"],
      ["notonq:similar", "Bigger Act", "medium"],
    ]);
    expect(rejected.map((r) => r.reason)).toEqual([
      "quote not found on the page",
      "quote not found on the page",
      "page could not be fetched or robots.txt disallows it",
      "source not allowed (www.qloo.com)",
    ]);
  });
});

describe("agent", () => {
  it("returns the model's claims as structured output, and does nothing when nothing is missing", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify({ claims: [claim({})] }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
        warnings: [],
      }),
    });
    expect(await research({ name: "Tiny Act", known: [], missing: ["disambiguation"] }, { model })).toEqual([claim({})]);
    expect(await research({ name: "Tiny Act", known: [], missing: [] }, { model })).toEqual([]);
  });
});

describe("runResearch", () => {
  let sql: Sql;
  beforeEach(async () => {
    sql = await memoryDb();
  });

  it("fills only empty fields from verified claims, cites each page and quote, adds Qloo-known stand-ins, and logs rejects", async () => {
    await saveFallback(sql, {
      id: "notonq:dz:555",
      nameKey: "tiny act",
      name: "Tiny Act",
      gapKind: "G1",
      entity: { name: "Tiny Act", entity_id: "notonq:dz:555", types: ["urn:entity:artist"], properties: { akas: [], external: { "notonq:deezer": { id: 555, fans: 2 } } }, tags: [] },
      provenance: {},
      standIns: [],
      unavailable: ["properties.short_description", "tags", "standIns (no similar artist known to Qloo)"],
      confidence: "low",
    });
    const before = (await findFallback(sql, { id: "notonq:dz:555" }))!;
    expect(missingFields(before)).toEqual(expect.arrayContaining(["properties.short_description", "tags", "disambiguation", "notonq:similar"]));

    const { fetch } = fakeFetch([
      ...pages,
      ["hackathon.api.qloo.com/search", (u) => (u.searchParams.get("query") === "Bigger Act" ? json(200, { results: [qlooArtist(31, "Bigger Act")] }) : json(404, { message: "No results" }))],
    ]);
    const claims: Claim[] = [
      claim({ field: "properties.short_description", value: "Tiny Act is a dream-pop duo from Brisbane, formed in 2023.", quote: "Tiny Act is a Brisbane dream-pop duo formed in 2023" }),
      claim({}),
      claim({ field: "tags", value: "dream-pop", quote: "Tiny Act is a Brisbane dream-pop duo" }),
      claim({ field: "properties.external.instagram", value: "tinyactband", quote: "Follow on Instagram @tinyactband" }),
      claim({ field: "notonq:similar", value: "Bigger Act", source_url: REVIEW, quote: "For fans of Bigger Act and Alvvays" }),
      claim({ field: "notonq:similar", value: "Alvvays", source_url: REVIEW, quote: "For fans of Bigger Act and Alvvays" }),
      claim({ field: "tags", value: "metal", quote: "Tiny Act is a Brisbane metal band" }),
    ];
    const out = await runResearch("notonq:dz:555", { sql, qloo: qlooClient({ apiKey: "r1", fetch }), fetch, agent: async () => claims });
    expect(out).toEqual({ status: "done", verified: 6, rejected: 1 });

    const after = (await findFallback(sql, { id: "notonq:dz:555" }))!;
    expect(after.researchStatus).toBe("done");
    expect(after.entity).toMatchObject({
      disambiguation: "Brisbane",
      properties: { short_description: "Tiny Act is a dream-pop duo from Brisbane, formed in 2023.", external: { instagram: { id: "tinyactband" } } },
      tags: [{ name: "dream-pop", tag_id: "notonq:urn:tag:genre:dream_pop" }],
    });
    expect(after.standIns).toEqual([expect.objectContaining({ entityId: qid(31), source: "research" })]);
    expect(after.provenance["properties.short_description"][0]).toMatchObject({ method: "researched", record: LABEL, source: "label.example" });
    expect(after.unavailable).toEqual([]);
    const stored = await claimsFor(sql, "notonq:dz:555");
    expect(stored.filter((c) => !c.verified)).toEqual([expect.objectContaining({ value: "metal", reason: "quote not found on the page" })]);

    // Once done, never again for this entity.
    expect((await runResearch("notonq:dz:555", { sql, qloo: qlooClient({ apiKey: "r1", fetch }), fetch, agent: async () => claims })).status).toBe("skipped");
  });
});
