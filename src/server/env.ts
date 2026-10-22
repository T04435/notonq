import "server-only";
import { z } from "zod";

// One validated env module, server-only. "SET_ME" and empty strings count as missing.
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v !== "SET_ME" ? v : undefined));

const Env = z.object({
  /** Our own Qloo key: used only by the playground. REST callers always bring their own. */
  QLOO_API_KEY: optional,
  QLOO_BASE_URL: z.string().url().default("https://hackathon.api.qloo.com"),
  /** Our own Last.fm key: playground only. REST callers send X-Lastfm-Key. */
  LASTFM_API_KEY: optional,
  /** Neon in deployed envs. Unset locally → an embedded PGlite database in .data/. */
  DATABASE_URL: optional,
  /** Salt for hashing caller keys in the demand ledger. */
  NOTONQ_SALT: z.string().default("notonq-local-salt"),
});

export const env = Env.parse(process.env);
