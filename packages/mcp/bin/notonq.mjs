#!/usr/bin/env node
// notonq mcp: an MCP stdio server. Configure it where you'd configure `qloo mcp`.
//   QLOO_API_KEY     your Qloo key (required; forwarded as-is, never stored)
//   LASTFM_API_KEY   your Last.fm key (optional; enables similar artists and listener counts)
//   NOTONQ_URL       the NotOnQ host (default http://localhost:3400)
//   NOTONQ_APP       a label for your app in NotOnQ's demand counts (optional)
import { startNotonqMcp } from "../lib/server.mjs";

const [command] = process.argv.slice(2);
if (command !== "mcp") {
  process.stderr.write("Usage: notonq mcp\nRuns an MCP stdio server: the official Qloo harness, with NotOnQ filling artists Qloo has no data for.\n");
  process.exit(command ? 2 : 0);
}
if (!process.env.QLOO_API_KEY) {
  process.stderr.write("QLOO_API_KEY is required (your own Qloo key).\n");
  process.exit(3);
}
await startNotonqMcp({
  notonqUrl: process.env.NOTONQ_URL ?? "http://localhost:3400",
  qlooKey: process.env.QLOO_API_KEY,
  lastfmKey: process.env.LASTFM_API_KEY,
  app: process.env.NOTONQ_APP ?? "notonq-mcp",
});
