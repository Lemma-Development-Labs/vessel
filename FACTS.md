# FACTS

Date: 2026-08-29; testnet section re-checked against chain 2026-09-30 (see docs/FACT_CHECKS.md).

## Local Anvil (chainId 31337)

Re-run `script/Deploy.s.sol` against Anvil. Do not overwrite the committed testnet `ADDRESSES.json` unless you snapshot it first.

| Field | Value |
| --- | --- |
| chainId | 31337 |
| venue | sim |
| verify status | **not applicable** (local) |
| dead shares | 100 dUSD to `0x…dEaD` at deploy |
| SimVenue seed | 100 dUSD from SEEDER_PK (≠ deployer) |

## Monad Testnet (10143)

| Field | Value |
| --- | --- |
| Deploy | **broadcast** 2026-08-29, `deployedBlock` 57923009 |
| Deployer | `0xFfae50A3Ecc660fFF2B83e0B75F52c0A5F4E0F78` (owner is the Safe `0xe4f2…0279`) |
| Seeder | `0x138114870DF3FB683862bd31b4b185aF4e979b8E` (≠ deployer) — seeded 100 dUSD at block 57,923,138. `0x25dd…4235` seeded an earlier deployment. |
| Keeper (gas) | `0x2A3fE0AD525d954D43C59E3Ee2907f9D2C17de65` — on Railway since 2026-08-29. **Out of gas since 2026-09-28 06:56 UTC** (last crank; `/health` reports 0.023 MON, 0 cranks of runway on 2026-09-30). Supersedes `0x19B269D7…08dc`, which was never funded into service. |
| e2e burner | `0xfD49f731679FC9959A3F73dDE3d6444ed619030A` |
| Verify | Sourcify via `https://sourcify-api-monad.blockvision.org/` (`solc 0.8.24`, optimizer 200, via-ir). DemoUSD confirmed `already verified`. |
| e2e live | **PASS** 2026-08-29, burner `0xfD49f731679FC9959A3F73dDE3d6444ed619030A`, 60s wall clock. See HARDENING.md. |

## Monad Mainnet (143)

Mirror **not deployed**. Real MON required. Same honest gap as the whitepaper.

## Verify runsheet (per deploy, both chains)

Toolchain: solc **0.8.24**, optimizer **200**, via-ir, evm cancun — match `contracts/foundry.toml`.

```bash
# https://docs.monad.xyz/guides/verify-smart-contract
forge verify-contract <ADDR> src/DemoUSD.sol:DemoUSD --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/ \
  --via-ir --num-of-optimizations 200 --compiler-version v0.8.24 --watch
# Guardian: constructor (address initialOwner)
# BlitzVault: (address dUsd, address guardian)
# Tranches: (address vault, address guardian, address treasury)
# SimVenue: (address dUsd)
# PerplVenue: ()
# EngineLite: (address guardian)
# TrancheToken Hull/Ballast: (string name, string symbol)
# constructor args: cast abi-encode "constructor(...)" ...
```

The seven protocol contracts: DemoUSD, Guardian, BlitzVault, Tranches, SimVenue, PerplVenue, EngineLite. MockWMON/MockRouter are extra for sim deploys.

## Keys (roles, not secrets)

| Role | Anvil default (well-known Foundry keys) | Testnet (10143) |
| --- | --- | --- |
| Deployer | account 0 `0xac09…ff80` | `0xFfae50A3Ecc660fFF2B83e0B75F52c0A5F4E0F78` |
| Seeder | account 1 `0x59c6…690d` | `0x138114870DF3FB683862bd31b4b185aF4e979b8E` |
| Keeper (gas only) | account 1 locally | `0x2A3fE0AD525d954D43C59E3Ee2907f9D2C17de65` |
| e2e burner | account 2 `0x5de4…365a` | `0xfD49f731679FC9959A3F73dDE3d6444ed619030A` |

These three must remain distinct on testnet. Never commit private keys.

## Venues (verified 2026-10-05)

Testnet column read on chain this day; mainnet column from venue docs and earlier reads.

Dollars: users only ever hold **Circle USDC**. AUSD is Perpl margin, internal to the engine (D02). dUSD is retired at the next deployment. Kuru's testnet "USD Coin" is not Circle USDC; never use it.

| | Testnet (10143) | Mainnet (143) |
| --- | --- | --- |
| Circle USDC (6 dp) | `0x534b2f3A21130d7a60830c2Df862319e593943A3` — faucet.circle.com, 20 / 2 h / address | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| AUSD (6 dp, Perpl collateral) | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` — the exchange holds ~64.3M. Perpl's README still names "Test USD" `0xdf5b…c027`; the exchange holds none, so that line is stale. No public faucet found. | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |
| Perpl exchange | `0x1964C32f0bE608E7D29302AFF5E61268E72080cc` (impl `0xbcbd…adbb`), MON perp **64**: price 5 dp, lot 0 dp (1 lot = 1 MON), min account open 100 AUSD | `0x34B6552d57a35a1D042CcAe1951BD1C370112a6F`, MON perp **10** |
| Kuru Router (permissionless `deployProxy`, `anyToAnySwap`) | `0x7EFbE105Ca7415dE98F96622173458ac1c054630`, MarginAccount `0xd029C2D98ff85D8F64799017fE00a59B1159CE02` | `0xd651346d7c789536ebf06dc72aE3C8502cd695CC`, MarginAccount `0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5` |
| Kuru MON/USDC, MON/AUSD | **None against Circle USDC or AUSD** — Vessel opens and seeds its own (proven on fork) | `0x065C9d28E428A0db40191a54d33d5b7c71a9C394`, `0x131a2e70a5b31a517a74b8c567149bc294470da9` |

Perpl order types are **0-based**: 0 OpenLong, 1 OpenShort, 2 CloseLong, 3 CloseShort (dex-sdk `RequestType`). ABI: PerplFoundation/dex-sdk `crates/sdk/abi/dex/Exchange.json` (rc_v1.1.7-203); all used selectors present in the testnet impl.

Test assets for seeding the Vessel Kuru markets (testnet):

- **AUSD:** Agora's faucet `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` (proxy → impl `0xba80…2a49`), `requestFunds(address recipient)`: 10,000 AUSD per call, at most once a minute, until the recipient holds 100,000. Self-serve; no team request needed.
- **Circle USDC:** faucet.circle.com, 20 every 2 hours per address.
- **MON:** public faucets give about 1–10 per wallet per day, so the ~40k needed must be requested from the Monad (or Kuru) team.
- **Seeder (Kuru market maker):** `0x933DF4E2c927903D68c1FC82691b9a06dC6249F9`, key `KURU_SEEDER_PK` in `contracts/.env`. Holds 30,000 AUSD as of 2026-10-06. Distinct from the v0 `SEEDER_PK` wallet.

Fork proofs (opt-in: `VENUE_FORK=1 forge test --match-path 'test/fork/*Proof*' --fork-url <testnet rpc>`):

- `PerplProof` — a **contract** owns Perpl account #842: create 500 AUSD, deposit 100, short 1,000 MON IOC at 0.03107, close, withdraw 599.94 AUSD to custody (G01 shape on testnet).
- `KuruProof` — Vessel opens MON/USDC (Circle) and MON/AUSD; flip orders ±3 bps plus a vault backstop quote both sides; USDC → MON → AUSD in one `anyToAnySwap` under a floor: 100 USDC → 99.936 AUSD → 99.873 USDC (12.7 bps round trip, inside the 20 bps budget). Below the floor, the whole route reverts.
- Seed per market used: 2,000 quote + 74,500 MON (64,500 flip + 10,000 vault) + 310 quote (vault). Our testnet wallets hold ~10 MON, so **test MON is the binding constraint**.
