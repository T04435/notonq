import { SCHEMA } from "@/server/store/schema";

// One tiny SQL surface for both databases: Neon (serverless HTTP driver) when DATABASE_URL is set, otherwise an
// embedded PGlite (real Postgres in WASM) under .data/ for local runs. Same SQL, same results.
export type Sql = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

// One connection per process. Next.js loads route handlers and server components as separate bundles, so a module
// variable would give each bundle its own PGlite on the same folder: writes in one were invisible to the other (and
// two instances on one data dir risk corrupting it). globalThis is shared across bundles.
const shared = globalThis as typeof globalThis & { __notonqDb?: Promise<Sql> };

async function connect(databaseUrl?: string): Promise<Sql> {
  if (databaseUrl) {
    const { neon } = await import("@neondatabase/serverless");
    const client = neon(databaseUrl);
    const sql: Sql = async (text, params = []) => (await client.query(text, params)) as never;
    await migrate(sql);
    return sql;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("node:fs");
  const dir = process.env.NOTONQ_PGLITE_DIR ?? ".data/pglite";
  mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  const sql: Sql = async (text, params = []) => (await db.query(text, params)).rows as never;
  await db.exec(SCHEMA);
  return sql;
}

/** The schema as single statements: comments dropped first, so a "; -- note" line end still splits. */
export const schemaStatements = (schema = SCHEMA) =>
  schema
    .replace(/--[^\n]*/g, "")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

async function migrate(sql: Sql) {
  // The Neon HTTP driver runs one statement per call.
  for (const statement of schemaStatements()) await sql(statement);
}

/** Neon in deployed builds. Locally the embedded PGlite, even if `vercel env pull` wrote the production DATABASE_URL
 * into .env.local (learnings: env pull points local at prod), unless NOTONQ_USE_NEON=1 asks for Neon on purpose. */
export function db(databaseUrl = process.env.DATABASE_URL): Promise<Sql> {
  const useNeon = process.env.NODE_ENV === "production" || process.env.NOTONQ_USE_NEON === "1";
  shared.__notonqDb ??= connect(useNeon && databaseUrl && databaseUrl !== "SET_ME" ? databaseUrl : undefined).catch((e) => {
    shared.__notonqDb = undefined;
    throw e;
  });
  return shared.__notonqDb;
}

/** Tests use their own in-memory PGlite. */
export async function memoryDb(): Promise<Sql> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await pg.exec(SCHEMA);
  return async (text, params = []) => (await pg.query(text, params)).rows as never;
}
