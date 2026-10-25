import { describe, expect, it } from "vitest";
import { schemaStatements } from "@/server/store/db";
import { SCHEMA } from "@/server/store/schema";

// Neon's HTTP driver runs one statement per call and rejects "multiple commands in a prepared statement".
describe("schema statements for Neon", () => {
  it("splits the schema into single statements, ignoring inline comments", () => {
    const statements = schemaStatements(SCHEMA);
    expect(statements.length).toBeGreaterThan(5);
    for (const s of statements) expect(s).not.toMatch(/;/);
  });

  it("splits a statement that ends with a comment", () => {
    expect(schemaStatements("ALTER TABLE a ADD COLUMN b int;   -- note\n\n-- heading\nCREATE TABLE c (d int);\n")).toEqual([
      "ALTER TABLE a ADD COLUMN b int",
      "CREATE TABLE c (d int)",
    ]);
  });
});
