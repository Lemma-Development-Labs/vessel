import type { Abi } from "viem";

/** EngineLite: crank + views the keeper/API/indexer actually call. */
export const engineLiteAbi = [
  {
    type: "function",
    name: "crank",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "netDelta",
    inputs: [],
    outputs: [{ name: "", type: "int256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "netDeltaBps",
    inputs: [],
    outputs: [{ name: "", type: "int256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastCrank",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastSpotValue",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "shortId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "venue",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Cranked",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "grossYield", type: "int256", indexed: false },
      { name: "netDeltaBps", type: "int256", indexed: false },
    ],
  },
  { type: "error", name: "AlreadyDeployed", inputs: [] },
  { type: "error", name: "NotWired", inputs: [] },
  { type: "error", name: "NothingDeployable", inputs: [] },
  { type: "error", name: "Paused", inputs: [] },
  { type: "error", name: "DtZero", inputs: [] },
] as const satisfies Abi;

/** Tranches: deckStats + Waterfall (+ DtZero so nested settle reverts decode). */
export const tranchesAbi = [
  {
    type: "function",
    name: "deckStats",
    inputs: [],
    outputs: [
      { name: "hullTvl_", type: "uint256" },
      { name: "balTvl_", type: "uint256" },
      { name: "reserve_", type: "uint256" },
      { name: "treasuryAccrued_", type: "uint256" },
      { name: "hullSupply", type: "uint256" },
      { name: "balSupply", type: "uint256" },
      { name: "lastSettle_", type: "uint256" },
      { name: "thetaBps", type: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "Waterfall",
    inputs: [
      { name: "gross", type: "int256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
      { name: "toReserve", type: "uint256", indexed: false },
      { name: "toTreasury", type: "uint256", indexed: false },
      { name: "hullAccrual", type: "uint256", indexed: false },
      { name: "toBallast", type: "uint256", indexed: false },
      { name: "fromBallast", type: "uint256", indexed: false },
      { name: "fromReserve", type: "uint256", indexed: false },
      { name: "hullTvl", type: "uint256", indexed: false },
      { name: "balTvl", type: "uint256", indexed: false },
      { name: "reserve", type: "uint256", indexed: false },
      { name: "ts", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "DtZero", inputs: [] },
  { type: "error", name: "Paused", inputs: [] },
] as const satisfies Abi;

/** Venue: funding on crank (SimVenue / PerplVenue share this surface). */
export const venueAbi = [
  {
    type: "function",
    name: "position",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "notional", type: "uint256" },
      { name: "fundingAccrued", type: "int256" },
    ],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "FundingSwept",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "realized", type: "int256", indexed: false },
    ],
  },
] as const satisfies Abi;
