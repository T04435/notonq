import { describe, expect, it } from "vitest";
import { answeredByNotOnQ } from "@/server/store/benchmark-stats";

const call = (stage: string, tool: string, status: string, results: unknown[]) => ({ type: "call", stage, tool, status, results });

describe("answeredByNotOnQ", () => {
  it("counts a fill question as answered only when NotOnQ's step got data from the tool that answers it", () => {
    expect(answeredByNotOnQ("map", [call("qloo", "qloo_where_popular", "needs_input", []), call("notonq", "qloo_where_popular", "ok", [{ name: "Havana" }])])).toBe(true);
    expect(answeredByNotOnQ("map", [call("qloo", "qloo_where_popular", "ok", [{ name: "Havana" }])])).toBe(false);
    expect(answeredByNotOnQ("ages", [call("notonq", "qloo_audience_demographics", "ok", [])])).toBe(false);
    expect(answeredByNotOnQ("similar", [call("notonq", "qloo_where_popular", "ok", [{ name: "x" }])])).toBe(false);
  });
});
