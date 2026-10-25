import { OPENAPI } from "@/server/openapi";

// The machine-readable description of the drop-in REST API (also linked from the docs).
export function GET() {
  return Response.json(OPENAPI);
}
