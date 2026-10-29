import { SCHEMA } from "@/server/store/schema";

// One tiny SQL surface: Neon (serverless HTTP driver) everywhere the app runs. Locally that's the Neon dev branch
// (.env.development.local); deployed, the branch Vercel's Neon integration sets. Tests use an in-memory PGlite.
export type Sql = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

// One connection (and one schema check) per process. Next.js loads route handlers and server components as separate
// bundles, so a module variable would connect and migrate once per bundle. globalThis is shared across bundles.
const shared = globalThis as typeof globalThis & { __notonqDb?: Promise<Sql> };

async function connect(databaseUrl: string): Promise<Sql> {
  assertMayConnect(databaseUrl);
  const { neon } = await import("@neondatabase/serverless");
  const client = neon(databaseUrl);
  const sql: Sql = async (text, params = []) => (await client.query(text, params)) as never;
  // One transaction behind an advisory lock: cold starts that arrive together (three parallel searches) each migrate,
  // and unserialized they raced on DROP VIEW / CREATE VIEW import_queue and answered 500 (29 Oct, Busk Map).
  await client.transaction(migrationBatch().map((s) => client.query(s)));
  return sql;
}

/** The schema as single statements: comments dropped first, so a "; -- note" line end still splits. */
export const schemaStatements = (schema = SCHEMA) =>
  schema
    .replace(/--[^\n]*/g, "")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

/** The production branch's endpoint (Neon main). Local and preview runs use the dev branch; only production may use it. */
const PRODUCTION_ENDPOINT = "ep-green-sunset-b7pj2z61";

/** Throws when a run that isn't Vercel production points at the production database. */
export function assertMayConnect(databaseUrl: string, vercelEnv = process.env.VERCEL_ENV) {
  if (databaseUrl.includes(PRODUCTION_ENDPOINT) && vercelEnv !== "production")
    throw new Error("Refusing to use the production database outside Vercel production (VERCEL_ENV=production). Use the dev branch (.env.development.local).");
}

/** Any fixed key: every process takes the same lock, so only one migrates at a time. */
const MIGRATION_LOCK = 4_242_001;

/** The migration as one batch for a single transaction: the lock first (released at commit), then each statement. */
export const migrationBatch = (schema = SCHEMA) => [`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`, ...schemaStatements(schema)];

export function db(databaseUrl = process.env.DATABASE_URL): Promise<Sql> {
  if (!databaseUrl || databaseUrl === "SET_ME") return Promise.reject(new Error("DATABASE_URL isn't set: locally it comes from .env.development.local (the Neon dev branch)."));
  shared.__notonqDb ??= connect(databaseUrl).catch((e) => {
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
