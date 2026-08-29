export const MIN_JOIN = 1_000_000n; // 1 dUSD, matches Tranches.MIN_JOIN

/**
 * Explicit gas limits (Monad charges the LIMIT). Values are ~1.3× observed
 * forge-test usage, capped. See contracts/.gas-snapshot.
 */
export const GAS = {
  faucet: 200_000n,
  approve: 80_000n,
  join: 650_000n,
  exit: 550_000n,
  crank: 1_300_000n,
  deployLiquidity: 1_500_000n,
} as const;
