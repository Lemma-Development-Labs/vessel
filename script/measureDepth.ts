#!/usr/bin/env tsx
/**
 * measureDepth.ts — realised slippage buying MON with Kuru USDC on the
 * official MON-USDC book (10143). Writes a markdown table suitable for
 * docs/CAPACITY.md.
 *
 * Usage:
 *   MONAD_TESTNET_RPC=<url> npx tsx script/measureDepth.ts
 *   # optional: append slot label (morning|afternoon|evening)
 *   MEASURE_SLOT=morning npx tsx script/measureDepth.ts
 *
 * Gas note (MONSKILLS gas/): Monad charges on gas_limit, not gas_used.
 * Staticcalls here do not spend gas; live swaps must set a tight limit.
 */
import {
  createPublicClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
} from "viem";

const ORDER_BOOK = "0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9" as Address;
const KURU_USDC = "0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570" as Address;
const SIZES_USDC = [100, 500, 1_000, 5_000] as const;

const bookAbi = parseAbi([
  "function bestBidAsk() view returns (uint256 bestBid, uint256 bestAsk)",
  "function getMarketParams() view returns (uint32 pricePrecision, uint96 sizePrecision, address baseAsset, uint256 baseAssetDecimals, address quoteAsset, uint256 quoteAssetDecimals, uint32 tickSize, uint96 minSize, uint96 maxSize, uint256 takerFeeBps, uint256 makerFeeBps)",
  "function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minAmountOut, bool isMargin, bool isFillOrKill) payable returns (uint256 baseOut)",
]);

async function main() {
  const rpc =
    process.env.MONAD_TESTNET_RPC ||
    process.env.FOUNDRY_ETH_RPC_URL ||
    "https://testnet-rpc.monad.xyz";
  const slot = process.env.MEASURE_SLOT || new Date().toISOString();
  const client = createPublicClient({ transport: http(rpc) });

  const chainId = await client.getChainId();
  if (chainId !== 10143) {
    throw new Error(`expected chain 10143, got ${chainId}`);
  }
  const block = await client.getBlockNumber();
  const [bestBid, bestAsk] = await client.readContract({
    address: ORDER_BOOK,
    abi: bookAbi,
    functionName: "bestBidAsk",
  });
  const params = await client.readContract({
    address: ORDER_BOOK,
    abi: bookAbi,
    functionName: "getMarketParams",
  });
  const pricePrecision = BigInt(params[0]);
  const quoteAsset = params[4];
  if (quoteAsset.toLowerCase() !== KURU_USDC.toLowerCase()) {
    throw new Error(`quote asset mismatch: ${quoteAsset}`);
  }

  const empty =
    bestAsk === 0n ||
    bestBid === 0n ||
    bestBid ===
      115792089237316195423570985008687907853269984665640564039457584007913129639935n;

  console.log(`# Depth probe`);
  console.log(`- slot: ${slot}`);
  console.log(`- block: ${block}`);
  console.log(`- bestBid: ${bestBid}`);
  console.log(`- bestAsk: ${bestAsk}`);
  console.log(`- pricePrecision: ${pricePrecision}`);
  console.log(`- emptyBook: ${empty}`);
  console.log("");
  console.log(`| USDC in | baseOut (MON) | mid MON/USDC | effective | slippage bps | note |`);
  console.log(`| --- | --- | --- | --- | --- | --- |`);

  const mid =
    !empty && bestAsk > 0n
      ? Number(pricePrecision) / Number(bestAsk)
      : NaN;

  for (const usdc of SIZES_USDC) {
    const quoteIn6 = BigInt(usdc) * 10n ** 6n;
    // Kuru market-buy size = humanQuote * pricePrecision
    const quoteSize = (quoteIn6 * pricePrecision) / 10n ** 6n;
    if (empty) {
      console.log(
        `| ${usdc} | — | — | — | — | no ask liquidity at block ${block} |`,
      );
      continue;
    }
    try {
      const baseOut = await client.simulateContract({
        address: ORDER_BOOK,
        abi: bookAbi,
        functionName: "placeAndExecuteMarketBuy",
        args: [quoteSize, 1n, false, true],
        account: "0x0000000000000000000000000000000000000001",
      });
      // simulateContract returns result in result field when using viem differently —
      // use call static via read-style eth_call wrapper:
      void baseOut;
    } catch {
      /* fall through to eth_call decode */
    }

    let baseOut = 0n;
    let note = "ok";
    try {
      baseOut = (await client.readContract({
        address: ORDER_BOOK,
        abi: bookAbi,
        functionName: "placeAndExecuteMarketBuy",
        args: [quoteSize, 0n, false, true],
        account: "0x0000000000000000000000000000000000000001",
      })) as bigint;
    } catch (e) {
      note = `eth_call revert: ${(e as Error).message?.slice(0, 80) || "unknown"}`;
      console.log(`| ${usdc} | — | ${mid.toFixed?.(6) ?? "—"} | — | — | ${note} |`);
      continue;
    }

    const mon = Number(formatUnits(baseOut, 18));
    const effective = mon > 0 ? usdc / mon : NaN;
    const slipBps =
      Number.isFinite(mid) && Number.isFinite(effective) && mid > 0
        ? Math.round(((effective - mid) / mid) * 10_000)
        : NaN;
    console.log(
      `| ${usdc} | ${mon.toFixed(6)} | ${mid.toFixed(6)} | ${effective.toFixed(6)} | ${Number.isFinite(slipBps) ? slipBps : "—"} | ${note} |`,
    );
  }

  console.log("");
  console.log(
    "If 1,000 USDC moves the book more than 50 bps, shrink the genesis deck.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
