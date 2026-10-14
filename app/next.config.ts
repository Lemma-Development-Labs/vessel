import type { NextConfig } from "next";

/**
 * Auth reaches vessel-service same-origin (docs/AUTH.md): the browser calls
 * /api/auth/*, Next proxies it to VESSEL_API_URL/auth/*. Cookies are therefore
 * first-party on the app domain and the service never grants credentialed
 * CORS. VESSEL_API_URL is server-side only (no NEXT_PUBLIC_ prefix). Unset →
 * no rewrite, and the onboarding page reports auth as unavailable.
 */
function authRewriteTarget(): string | null {
  const raw = process.env.VESSEL_API_URL?.trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`VESSEL_API_URL must be https (or localhost): ${raw}`);
  }
  return url.origin;
}

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
    const target = authRewriteTarget();
    return target ? [{ source: "/api/auth/:path*", destination: `${target}/auth/:path*` }] : [];
  },
};

export default nextConfig;
