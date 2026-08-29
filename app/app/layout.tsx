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

export const metadata: Metadata = {
  title: "Vessel — The dollar leverage pays for.",
  description: "Delta-neutral tranche yield on Monad. Unaudited testnet.",
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
