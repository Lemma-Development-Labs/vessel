import { createHash, randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys against the real app and the real vessel-service.
 *
 * - vessel-service runs as testnet with an in-process PGlite (no DATABASE_URL)
 *   and accepts two invitation codes generated for this run; only their
 *   SHA-256 digests are passed to it (AUTH_SEED_INVITE_SHA256S, non-mainnet).
 * - The app runs `next dev` in live mode and proxies /api/auth/* to the service.
 * - The wallet is an in-page EIP-1193 provider whose key is generated per test
 *   in the Node process (e2e/wallet.ts). No key material is stored anywhere.
 *
 * Needs network access to the Monad testnet RPC: the service verifies the
 * RPC's chain ID at startup and refuses to run otherwise.
 */
const APP_PORT = 3930;
const API_PORT = 3931;

function inviteCodes(): string[] {
  const existing = process.env.E2E_INVITE_CODES;
  if (existing) return existing.split(",");
  const codes = [randomBytes(18).toString("base64url"), randomBytes(18).toString("base64url")];
  // Exported so the spec files (same process tree) read the same codes.
  process.env.E2E_INVITE_CODES = codes.join(",");
  return codes;
}
const codes = inviteCodes();
const seeded = codes.map((c) => createHash("sha256").update(c).digest("hex")).join(",");

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile-360", use: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      name: "vessel-service",
      command: "node --import tsx src/index.ts",
      cwd: "../vessel-service",
      stdout: "pipe",
      stderr: "pipe",
      url: `http://127.0.0.1:${API_PORT}/live`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VESSEL_ENV: "testnet",
        RPC_URL: "https://testnet-rpc.monad.xyz",
        CHAIN_ID: "10143",
        PORT: String(API_PORT),
        AUTH_DOMAIN: `localhost:${APP_PORT}`,
        AUTH_ORIGIN: `http://localhost:${APP_PORT}`,
        AUTH_SEED_INVITE_SHA256S: seeded,
        LOG_LEVEL: "warn",
      },
    },
    {
      name: "app",
      command: `pnpm exec next dev --port ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}/onboarding`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        VESSEL_API_URL: `http://127.0.0.1:${API_PORT}`,
        // Live mode, as in production: chain reads hit the testnet RPC and the
        // header shows the real wallet (mock mode fakes a connected address).
        NEXT_PUBLIC_USE_MOCK: "0",
        NEXT_PUBLIC_CHAIN_ID: "10143",
        NEXT_PUBLIC_RPC: "https://testnet-rpc.monad.xyz",
      },
    },
  ],
});
