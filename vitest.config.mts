import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // MusicBrainz is paced at 1 call a second, as its API rules ask, so a full fill takes several seconds even on fakes.
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node", testTimeout: 15_000 },
});
