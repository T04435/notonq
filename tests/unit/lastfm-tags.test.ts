import { describe, expect, it } from "vitest";
import { artistInfo } from "@/server/adapters/lastfm";
import { fakeFetch, json } from "./fixtures";

describe("Last.fm artist tags as genres", () => {
  it("keeps genres and drops where the artist is from and listening habits", async () => {
    const tags = ["emo", "midwest emo", "japanese", "alternative rock", "japan", "seen live", "2020s"].map((name) => ({ name }));
    const { fetch } = fakeFetch([["method=artist.getinfo", () => json(200, { artist: { name: "ANORAK!", stats: { listeners: "900" }, tags: { tag: tags } } })]]);
    expect((await artistInfo("ANORAK!", "lf", { fetch }))?.tags).toEqual(["emo", "midwest emo", "alternative rock"]);
  });
});
