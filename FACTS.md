# FACTS

Date: 2026-08-29.

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
| Deploy | **broadcast** 2026-08-29, `deployedBlock` 57874280 |
| Deployer | `0x85Fe6D9399EA584Ba5344b8d21e27137adbB5738` |
| Seeder | `0x25dd6Bd48fD0F6254Cc15D43a86d801ec83f4235` (≠ deployer) |
| Keeper (gas) | `0x2A3fE0AD525d954D43C59E3Ee2907f9D2C17de65` — live on Railway since 2026-08-29. Supersedes `0x19B269D7…08dc`, which was never funded into service. |
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
| Deployer | account 0 `0xac09…ff80` | `0x85Fe6D9399EA584Ba5344b8d21e27137adbB5738` |
| Seeder | account 1 `0x59c6…690d` | `0x25dd6Bd48fD0F6254Cc15D43a86d801ec83f4235` |
| Keeper (gas only) | account 1 locally | `0x2A3fE0AD525d954D43C59E3Ee2907f9D2C17de65` |
| e2e burner | account 2 `0x5de4…365a` | `0xfD49f731679FC9959A3F73dDE3d6444ed619030A` |

These three must remain distinct on testnet. Never commit private keys.
