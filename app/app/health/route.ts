import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness probe for the Next server ONLY.
 *
 * It deliberately does not claim anything about the protocol, the keeper or the
 * indexer — this process cannot observe them, and a green tick here while the
 * keeper is dead would be exactly the kind of comforting lie the rest of this
 * codebase is being cleaned of. System health lives at /status, which reads the
 * stats service and says so when it cannot.
 *
 * It DOES report which data provider the bundle was built against. That is not
 * decoration: a deployment silently built in mock mode shows invented numbers
 * on every screen, and the only way to tell from outside was to open devtools
 * and recognise the seeded values. Now you can curl it.
 */
export function GET() {
  const useMock = process.env.NEXT_PUBLIC_USE_MOCK !== "0";
  return NextResponse.json({
    ok: true,
    scope: "web app process only — see /status for protocol and keeper health",
    provider: useMock ? "mock" : "chain",
    warning: useMock
      ? "This deployment serves DEMO data, not chain state. Set NEXT_PUBLIC_USE_MOCK=0."
      : undefined,
    config: {
      chainId: process.env.NEXT_PUBLIC_CHAIN_ID ?? null,
      rpcConfigured: Boolean(process.env.NEXT_PUBLIC_RPC),
      statsUrlConfigured: Boolean(process.env.NEXT_PUBLIC_STATS_URL),
      walletConnectConfigured: Boolean(process.env.NEXT_PUBLIC_WC_PROJECT_ID),
      explorer: process.env.NEXT_PUBLIC_EXPLORER ?? null,
    },
  });
}
