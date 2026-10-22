import { Badge } from "@/components/ui/badge";
import { appVersion, envTag, versionText, type AppVersion } from "@/lib/version";

const link = "rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * The running version: GhostQ's Badge in its primary variant, all in one colour and font-mono (the shared
 * VersionBadge design, variant B "Primary badge, own line"). "v1.1.0 @ b7595e4": the tag links to its GitHub release,
 * the hash to its commit. Off production the words say so: " · preview · <branch>" or " · local" (" · dirty").
 */
export function VersionBadge({ v = appVersion }: { v?: AppVersion }) {
  const env = envTag(v);
  const extra = env === "preview" ? [env, v.branch] : env === "local" ? [env, ...(v.dirty ? ["dirty"] : [])] : [];
  return (
    <Badge title={versionText(v)} className="font-mono">
      <span>
        <a href={v.releaseUrl} className={link}>
          v{v.version}
        </a>
        {" @ "}
        <a href={v.commitUrl} className={link}>
          {v.shortSha}
        </a>
        {extra.filter(Boolean).map((part) => ` · ${part}`)}
      </span>
    </Badge>
  );
}
