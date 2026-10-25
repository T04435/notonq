import { describe, expect, it } from "vitest";
import { qlooClient } from "@/server/qloo/client";
import { cachedQloo, QlooBudgetExceeded } from "@/server/qloo/cached";
import { memoryDb } from "@/server/store/db";
import { qlooCallsToday } from "@/server/store/repo";
import { fakeFetch, json } from "./fixtures";

describe("daily Qloo budget", () => {
  it("counts real calls only, per caller, and stops at the budget", async () => {
    const sql = await memoryDb();
    const { fetch, calls } = fakeFetch([["/v2/tags", () => json(200, { results: { tags: [] } })]]);
    const a = cachedQloo(qlooClient({ apiKey: "k", fetch }), sql, "caller-a", 2);
    await a.get("/v2/tags", { "filter.query": "folk" });
    await a.get("/v2/tags", { "filter.query": "folk" }); // cache hit: free
    await a.get("/v2/tags", { "filter.query": "jazz" });
    expect(await qlooCallsToday(sql, "caller-a")).toBe(2);
    await expect(a.get("/v2/tags", { "filter.query": "rock" })).rejects.toBeInstanceOf(QlooBudgetExceeded);
    expect(calls.length).toBe(2);

    // Another caller has its own budget.
    const b = cachedQloo(qlooClient({ apiKey: "k2", fetch }), sql, "caller-b", 2);
    await expect(b.get("/v2/tags", { "filter.query": "rock" })).resolves.toMatchObject({ status: 200 });
  });
});
