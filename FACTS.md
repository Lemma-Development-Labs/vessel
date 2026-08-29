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
| Deployer | `0x4307C72a92063df4fa189c9e9621b741d457be7C` |
| Seeder | `0x25dd6Bd48fD0F6254Cc15D43a86d801ec83f4235` (≠ deployer) |
| Keeper (gas) | `0x19B269D761F34E3BE60E49Db6812E55d353008dc` |
| e2e burner | `0xfD49f731679FC9959A3F73dDE3d6444ed619030A` |
| Verify | Sourcify via `https://sourcify-api-monad.blockvision.org/` (`solc 0.8.24`, optimizer 200, via-ir). DemoUSD confirmed `already verified`. |
| e2e live | see [HARDENING.md](./HARDENING.md) / [docs/e2e-last-run.md](./docs/e2e-last-run.md) |

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
| Deployer | account 0 `0xac09…ff80` | `0x4307C72a92063df4fa189c9e9621b741d457be7C` |
| Seeder | account 1 `0x59c6…690d` | `0x25dd6Bd48fD0F6254Cc15D43a86d801ec83f4235` |
| Keeper (gas only) | account 1 locally | `0x19B269D761F34E3BE60E49Db6812E55d353008dc` |
| e2e burner | account 2 `0x5de4…365a` | `0xfD49f731679FC9959A3F73dDE3d6444ed619030A` |

These three must remain distinct on testnet. Never commit private keys.
