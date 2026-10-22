import { appVersion } from "@/lib/version";

// The standard's `export const dynamic = "force-static"` is left out: GhostQ uses Cache Components, which reject that
// segment config, and prerender a handler that reads no request data anyway, so it stays static.
export function GET() {
  return Response.json({ ...appVersion, deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null });
}
