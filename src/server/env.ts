import "server-only";
import { z } from "zod";

// One validated env module, server-only. "SET_ME" and empty strings count as missing.
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v !== "SET_ME" ? v : undefined));

const Env = z.object({
  /** Our own Qloo key: used only by the Ask page. REST callers always bring their own. */
  QLOO_API_KEY: optional,
  QLOO_BASE_URL: z.string().url().default("https://hackathon.api.qloo.com"),
  /** Our own Last.fm key: the Ask page, and REST callers who send no X-Lastfm-Key (hackathon demo). */
  LASTFM_API_KEY: optional,
  /** Neon: the dev branch locally (.env.development.local), the branch Vercel's integration sets when deployed. */
  DATABASE_URL: optional,
  /** Salt for hashing caller keys in the demand ledger. Set a random value in every deployed environment. */
  NOTONQ_SALT: z.string().default("notonq-local-salt"),
  /** Lets the benchmark batch (scripts/benchmark.mts) label its Ask runs benchmark-*. Unset: no Ask run can be labelled. */
  NOTONQ_BENCHMARK_TOKEN: optional,
});

export const env = Env.parse(process.env);
