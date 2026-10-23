// A loopback-only forwarder between the official Qloo harness and NotOnQ. The harness only lets you change its base
// URL, so this adds what it can't send itself: your own Last.fm key and an app label. Your Qloo key passes through
// untouched; nothing is logged or stored.
//
// It also notes when NotOnQ (rather than Qloo alone) answered a request, so the wrapper can label any tool's result,
// including heatmaps and demographics whose results carry no entity IDs.
import { createServer } from "node:http";

export async function startProxy({ target, lastfmKey, app }) {
  const base = target.replace(/\/+$/, "");
  /** NotOnQ answers seen since the last take(): { servedBy, standIns[] }. */
  let seen = [];
  const server = createServer(async (req, res) => {
    try {
      const headers = { "X-Api-Key": req.headers["x-api-key"] ?? "", "X-NotOnQ-App": app };
      if (lastfmKey) headers["X-Lastfm-Key"] = lastfmKey;
      const upstream = await fetch(`${base}${req.url}`, { headers, signal: AbortSignal.timeout(60_000) });
      const body = Buffer.from(await upstream.arrayBuffer());
      const servedBy = upstream.headers.get("x-notonq-served-by");
      if (servedBy && servedBy !== "qloo") {
        let standIns = [];
        try {
          standIns = (JSON.parse(body.toString("utf8"))?.notonq?.proxy?.stand_ins ?? []).map((s) => s.name);
        } catch {
          standIns = [];
        }
        seen.push({ servedBy, standIns });
      }
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
      res.end(body);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: `NotOnQ unreachable: ${e instanceof Error ? e.message : String(e)}` }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    /** Returns and clears what NotOnQ answered since the last call (one tool call at a time). */
    take: () => {
      const out = seen;
      seen = [];
      return out;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}
