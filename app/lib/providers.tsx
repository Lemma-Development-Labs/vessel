"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { useWalletSwitchGuard } from "./auth";
import { ChainVesselProvider } from "./chain";
import { MockVesselProvider } from "./mock";
import { mockEnabled } from "./mock-flag";
import { wagmiConfig } from "./wagmi";

/** Fixture data only when NEXT_PUBLIC_USE_MOCK is exactly "1" (lib/mock-flag.ts). */
export const USE_MOCK = mockEnabled(process.env.NEXT_PUBLIC_USE_MOCK);

export function Providers({ children }: { children: ReactNode }) {
  const demo = useSearchParams().get("demo");
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: false },
        },
      }),
  );

  const inner = USE_MOCK ? (
    <MockVesselProvider demo={demo}>{children}</MockVesselProvider>
  ) : (
    <ChainVesselProvider>{children}</ChainVesselProvider>
  );

  // The wallet (and therefore SIWE sign-in) is real in both modes: mock mode
  // replaces chain *data* with fixtures, never the user's wallet or session.
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <AuthGuards />
        {inner}
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function AuthGuards() {
  useWalletSwitchGuard();
  return null;
}
