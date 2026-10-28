import { describe, expect, it } from "vitest";
import { callDetail, callName } from "@/lib/call-label";

describe("callName", () => {
  it("names a call by what it asked for", () => {
    expect(callName("GET /q/search?query=Ksky&types=urn:entity:artist&take=5")).toBe("search");
    expect(callName("GET /q/entities?entity_ids=abc")).toBe("artist record");
    expect(callName("GET /q/entities?external.spotify.ids=x")).toBe("artist by Spotify ID");
    expect(callName("GET /q/v2/insights?filter.type=urn:heatmap&signal.interests.entities=a")).toBe("where popular");
    expect(callName("GET /q/v2/insights?filter.type=urn:entity:artist&signal.interests.entities=a")).toBe("recommend artists");
    expect(callName("GET /q/v2/insights?filter.type=urn:entity:artist&filter.results.entities=a,b")).toBe("rank artists");
  });
});

describe("callDetail", () => {
  it("says what came back, in plain words", () => {
    expect(callDetail("qloo", 200, "Qloo answered with 12 results; NotOnQ added nothing, so the body isn't kept.", null)).toBe("Qloo answered, 12 results");
    expect(callDetail("qloo", 400, undefined, null)).toBe("Qloo returned an error (400)");
    expect(callDetail("mixed", 200, undefined, { proxy: { stand_ins: [{}, {}, {}] } })).toBe("Answered through 3 similar artists Qloo knows");
    expect(callDetail("fallback", 200, undefined, { provenance: { name: [{ source: "musicbrainz" }], x: [{ source: "lastfm" }] } })).toBe("Filled in from MusicBrainz, Last.fm");
    expect(callDetail("needs_choice", 200, undefined, null)).toMatch(/waiting for a caller to choose/);
  });
});
