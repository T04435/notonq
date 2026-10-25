import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import pkg from "./package.json" with { type: "json" };

// The running version, baked in at build time (hackathon standard, learnings/2026-10-23-app-version-in-footer.md).
const git = (cmd: string) => {
  try {
    return execSync(cmd).toString().trim();
  } catch {
    return "";
  }
};
// Production is deployed by CI (.github/workflows/release.yml), which passes the version semantic-release worked out
// and the commit, since a CLI deploy uploads no .git. Elsewhere: the latest tag, else package.json (no longer bumped).
const version = process.env.APP_VERSION || git("git describe --tags --abbrev=0").replace(/^v/, "") || pkg.version;
const sha = process.env.APP_SHA || process.env.VERCEL_GIT_COMMIT_SHA || git("git rev-parse HEAD");
const dirty = !process.env.VERCEL && git("git status --porcelain") !== "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_APP_SHA: sha,
    NEXT_PUBLIC_APP_ENV: process.env.VERCEL_ENV || "local",
    NEXT_PUBLIC_APP_BRANCH: process.env.VERCEL_GIT_COMMIT_REF || git("git rev-parse --abbrev-ref HEAD"),
    NEXT_PUBLIC_APP_DIRTY: dirty ? "1" : "",
    NEXT_PUBLIC_APP_BUILT_AT: new Date().toISOString(),
    NEXT_PUBLIC_APP_REPO: "https://github.com/T04435/notonq",
  },
  // PGlite loads its WASM from its own package path; bundling it breaks that, so Node loads it as-is.
  serverExternalPackages: ["@electric-sql/pglite", "@qloo/qloo-harness"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
