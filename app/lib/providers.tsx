"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { ChainVesselProvider } from "./chain";
import { MockVesselProvider } from "./mock";
import { wagmiConfig } from "./wagmi";

/** Stage fallback. Flip to `0` after a live deploy. */
export const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== "0";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 4_000, refetchOnWindowFocus: false },
        },
      }),
  );

  const inner = USE_MOCK ? (
    <MockVesselProvider>{children}</MockVesselProvider>
  ) : (
    <ChainVesselProvider>{children}</ChainVesselProvider>
  );

  if (USE_MOCK) {
    return <QueryClientProvider client={queryClient}>{inner}</QueryClientProvider>;
  }

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{inner}</QueryClientProvider>
    </WagmiProvider>
  );
}
