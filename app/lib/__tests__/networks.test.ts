import { describe, expect, it } from "vitest";
import { NETWORKS, activeNetwork, isMainnetBuild } from "../networks";

describe("networks", () => {
  it("defaults to testnet profile", () => {
    const n = activeNetwork();
    expect(n.chainId).toBe(10143);
    expect(n.faucetEnabled).toBe(true);
    expect(n.banner).toMatch(/TESTNET/);
    expect(n.banner).toMatch(/unaudited/);
  });

  it("mainnet profile refuses deployed claim while JSON empty", () => {
    expect(NETWORKS[143].mainnetDeployed).toBe(false);
    expect(NETWORKS[143].banner).toMatch(/not deployed/);
    expect(NETWORKS[143].faucetEnabled).toBe(false);
  });

  it("isMainnetBuild follows env chain id", () => {
    expect(isMainnetBuild()).toBe(false);
  });
});
