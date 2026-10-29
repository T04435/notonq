import { describe, expect, it } from "vitest";
import { migrationBatch, schemaStatements } from "@/server/store/db";
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

describe("migration batch", () => {
  it("takes the advisory lock first, then runs every statement", () => {
    const batch = migrationBatch(SCHEMA);
    expect(batch[0]).toMatch(/^SELECT pg_advisory_xact_lock\(\d+\)$/);
    expect(batch.slice(1)).toEqual(schemaStatements(SCHEMA));
  });

  it("runs twice in one transaction each, as two cold starts would", async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    for (let i = 0; i < 2; i++) await pg.transaction(async (tx) => { for (const s of migrationBatch(SCHEMA)) await tx.query(s); });
    expect((await pg.query("SELECT count(*)::int AS n FROM import_queue")).rows).toEqual([{ n: 0 }]);
  });
});
