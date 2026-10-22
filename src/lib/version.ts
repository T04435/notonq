export type AppVersion = {
  version: string;
  sha: string;
  shortSha: string;
  env: "production" | "preview" | "development" | "local";
  branch: string;
  dirty: boolean;
  builtAt: string;
  releaseUrl: string;
  commitUrl: string;
};

const repo = process.env.NEXT_PUBLIC_APP_REPO ?? "";
const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const sha = process.env.NEXT_PUBLIC_APP_SHA ?? "";

export const appVersion: AppVersion = {
  version,
  sha,
  shortSha: sha.slice(0, 7),
  env: (process.env.NEXT_PUBLIC_APP_ENV as AppVersion["env"]) ?? "local",
  branch: process.env.NEXT_PUBLIC_APP_BRANCH ?? "",
  dirty: process.env.NEXT_PUBLIC_APP_DIRTY === "1",
  builtAt: process.env.NEXT_PUBLIC_APP_BUILT_AT ?? "",
  releaseUrl: `${repo}/releases/tag/v${version}`,
  commitUrl: `${repo}/commit/${sha}`,
};

export type EnvTag = "production" | "preview" | "local";
export const envTag = (v: AppVersion = appVersion): EnvTag =>
  v.env === "production" ? "production" : v.env === "preview" ? "preview" : "local";

/** "v1.1.0 @ b7595e4": the pill's main text (and the title for screen readers). */
export function versionLabel(v: AppVersion = appVersion): string {
  return `v${v.version} @ ${v.shortSha}`;
}

/** Plain-text form for logs, meta and bug reports: "v1.1.0 @ 3f1addd (preview, feat/sing)". */
export function versionText(v: AppVersion = appVersion): string {
  const env = envTag(v);
  if (env === "production") return versionLabel(v);
  const extra = env === "preview" ? v.branch : v.dirty ? "dirty" : "";
  return `${versionLabel(v)} (${[env, extra].filter(Boolean).join(", ")})`;
}
