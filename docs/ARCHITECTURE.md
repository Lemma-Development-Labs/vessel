# Architecture — spot via IRouter

## Spot GATE-0 (closed for venue selection)

`EngineLite` deploys and unwinds spot **only** through `IRouter`. There is no
`if (kuru)` branch in the engine. The live adapter is `KuruRouter`; the sandbox
adapter is `MockRouter`. Both implement the same four-function surface:

| Function | Role |
| --- | --- |
| `quoteExactQuoteForBase` | Off-chain / on-chain preview for buys |
| `quoteExactBaseForQuote` | Spot mark + preview for sells |
| `swapExactQuoteForBase(quoteIn, minBaseOut, deadline)` | Market buy |
| `swapExactBaseForQuote(baseIn, minQuoteOut, deadline)` | Market sell (unwind) |

`minOut` is **always caller-supplied**. `EngineLite.deployLiquidity(minBaseOut)`
and `EngineLite.unwind(minQuoteOut)` revert on `minOut == 0`. Implementations
also reject zero floors. Keepers / the app must compute floors from the book
(or from `CostEstimator` / `measureDepth`) — never hardcode `0` or a magic bps.

## Tokens (testnet 10143)

| Role | Token | Address |
| --- | --- | --- |
| Vault asset / Kuru quote | Kuru testnet USDC (6dec) | `0x3bA3d39AFcf8bb994f7964B3e0171Ea2Ba361570` |
| Engine base | WMON (18dec) | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` |
| Book base | native MON | `address(0)` on the MON-USDC market |
| Official market | MON-USDC | `0xa241896A7Dbe8a550D2E5fF7A914bB1989ceD2D9` |
| Margin account | Kuru MarginAccount | `0xd029C2D98ff85D8F64799017fE00a59B1159CE02` |

Circle USDC (`0x534b2f3A21130d7a60830c2Df862319e593943A3`) has **no** Kuru book.
Vault `asset()` for the live spot path must equal the book quote token.

## KuruRouter shape

Constructor: `(orderBook, marginAccount, quoteToken, baseToken)`.
No address literals in the contract body. Asserts `quote.decimals()==6` and
`base.decimals()==18`. Asserts book `quoteAsset == quoteToken` and book
`baseAsset == address(0)` (native MON). Wraps/unwraps WMON around fills.
Market orders use `fillOrKill=true` so a partial cannot rest and report success.

Buy size units: human quote × `pricePrecision` (not raw 6dec).
Sell size units: human base × `sizePrecision`; native sell sends `msg.value` in wei.

## Deploy selection

`contracts/script/Deploy.s.sol`:

- `SPOT_ROUTER=mock|kuru` overrides
- Default: `mock` on anvil (`31337`), `kuru` on Monad testnet (`10143`)

Mock path keeps DemoUSD + MockWMON + MockRouter (forced-negative sandbox).
Kuru path wires vault asset to Kuru USDC and base to real WMON.

## Capacity

Measured depth lives in [`CAPACITY.md`](./CAPACITY.md). Genesis AUM is capped
by realised slippage on that book — not by hope.

## Ship checklist (when book has asks + `DEPLOYER_PK`)

```bash
# 1) deploy adapter
forge script script/DeployKuruRouter.s.sol:DeployKuruRouter \
  --rpc-url $MONAD_TESTNET_RPC --broadcast --slow

# 2) one real swap (QUOTE_IN default = 1 USDC)
KURU_ROUTER=0x… forge script script/SwapViaKuruRouter.s.sol:SwapViaKuruRouter \
  --rpc-url $MONAD_TESTNET_RPC --broadcast --slow

# 3) verify (scaffold API — see .agents/skills/scaffold)
# 4) append TX_KURU_SPOT to docs/ADDRESSES.md
# 5) only then: Kuru logo ON, SIM chip off the spot leg
```
