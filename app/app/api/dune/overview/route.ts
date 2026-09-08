import { NextResponse } from "next/server";
import { fetchDuneOverview } from "@/lib/dune-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/dune/overview
 * Executes the published overview query via Dune API.
 * Returns { status: "unavailable", reason } when unset — never fabricates metrics.
 */
export async function GET() {
  const result = await fetchDuneOverview();
  if (result.status === "unavailable") {
    return NextResponse.json(result, { status: 503 });
  }
  return NextResponse.json(result);
}
