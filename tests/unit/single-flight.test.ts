import { describe, expect, it } from "vitest";
import { foldAccents } from "@/server/engine/era";
import { singleFlight } from "@/server/single-flight";

describe("singleFlight", () => {
  it("shares one run among callers of the same key at once, and runs again once it settles", async () => {
    const flight = singleFlight<number>();
    let runs = 0;
    const run = () => new Promise<number>((r) => setTimeout(() => r(++runs), 10));
    expect(await Promise.all([flight("a", run), flight("a", run), flight("b", run)])).toEqual([1, 1, 2]);
    expect(await flight("a", run)).toBe(3);
  });

  it("shares a failure too, and forgets it", async () => {
    const flight = singleFlight<number>();
    const fail = () => Promise.reject(new Error("busy"));
    await expect(Promise.all([flight("a", fail), flight("a", fail)])).rejects.toThrow("busy");
    expect(await flight("a", async () => 1)).toBe(1);
  });
});

describe("foldAccents", () => {
  it("folds accents and keeps everything else", () => {
    expect(foldAccents("Sevilla, España")).toBe("Sevilla, Espana");
    expect(foldAccents("Zürich")).toBe("Zurich");
    expect(foldAccents("Lagos")).toBe("Lagos");
  });
});
