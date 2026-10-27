import { describe, expect, it } from "vitest";
import { assertMayConnect } from "@/server/store/db";

describe("assertMayConnect", () => {
  const prod = "postgresql://u:p@ep-green-sunset-b7pj2z61-pooler.c-13.us-east-1.aws.neon.tech/neondb";
  const dev = "postgresql://u:p@ep-orange-breeze-b7qna96q-pooler.c-13.us-east-1.aws.neon.tech/neondb";

  it("refuses the production database outside Vercel production", () => {
    expect(() => assertMayConnect(prod, undefined)).toThrow(/Refusing/);
    expect(() => assertMayConnect(prod, "preview")).toThrow(/Refusing/);
    expect(() => assertMayConnect(prod, "production")).not.toThrow();
  });

  it("allows the dev branch anywhere", () => {
    expect(() => assertMayConnect(dev, undefined)).not.toThrow();
  });
});
