import { NextResponse } from "next/server";

/**
 * Liveness probe for the Next server ONLY.
 *
 * It deliberately does not claim anything about the protocol, the keeper or the
 * indexer — this process cannot observe them, and a green tick here while the
 * keeper is dead would be exactly the kind of comforting lie the rest of this
 * codebase is being cleaned of. System health lives at /status, which reads the
 * stats service and says so when it cannot.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    scope: "web app process only — see /status for protocol and keeper health",
  });
}
