import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "@/lib/providers";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppShell } from "@/components/shell";
import "./globals.css";

const display = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const sans = Instrument_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const SITE =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://testnet.vessel.wtf";

const TITLE = "Vessel — the hedge is public, every block.";
const DESCRIPTION =
  "Delta-neutral tranche yield on Monad testnet. HULL takes a fixed coupon, BALLAST absorbs first loss. Demo dollars, simulated venue, unaudited.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Vessel",
  // The link preview carries the testnet/unaudited chrome with it. Wherever this
  // gets pasted, it must not read as a live mainnet product.
  openGraph: {
    type: "website",
    siteName: "Vessel (testnet)",
    url: SITE,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Vessel",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070B10",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ErrorBoundary>
          <Suspense fallback={<div className="skeleton mx-auto mt-24 h-40 w-full max-w-xl" />}>
            <Providers>
              <AppShell>{children}</AppShell>
            </Providers>
          </Suspense>
        </ErrorBoundary>
      </body>
    </html>
  );
}
