# FACTS

Date: 2026-08-29.

## Local Anvil (chainId 31337)

Source of truth: [`ADDRESSES.json`](./ADDRESSES.json) as last written by `script/Deploy.s.sol`.

| Field | Value |
| --- | --- |
| chainId | 31337 |
| venue | sim |
| verify status | **not applicable** (local). No Sourcify green tick. |
| dead shares | 100 dUSD to `0x…dEaD` at deploy |
| SimVenue seed | 100 dUSD from SEEDER_PK (≠ deployer) |

## Monad Testnet (10143)

| Field | Value |
| --- | --- |
| Deploy | **not broadcast in this environment** (no funded `DEPLOYER_PK`) |
| Verify | **not run** — explorer columns in README stay "—" |
| e2e live | **not run** against 10143. `pnpm e2e` was executed on Anvil (see HARDENING.md). |

## Monad Mainnet (143)

Mirror **not deployed**. Real MON required. Same honest gap as the whitepaper.

## Verify runsheet (per deploy, both chains)

Toolchain: solc **0.8.24**, optimizer **200**, via-ir, evm cancun — match `contracts/foundry.toml`.

```bash
# https://docs.monad.xyz/guides/verify-smart-contract
forge verify-contract <ADDR> src/DemoUSD.sol:DemoUSD --chain 10143 \
  --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
# Guardian: constructor (address initialOwner)
# BlitzVault: (address dUsd, address guardian)
# Tranches: (address vault, address guardian, address treasury)
# SimVenue: (address dUsd)
# PerplVenue: ()
# EngineLite: (address guardian)
# constructor args: cast abi-encode "constructor(...)" ...
```

The seven protocol contracts: DemoUSD, Guardian, BlitzVault, Tranches, SimVenue, PerplVenue, EngineLite. MockWMON/MockRouter are extra for sim deploys.

## Keys (roles, not secrets)

| Role | Anvil default (well-known Foundry keys) |
| --- | --- |
| Deployer | account 0 `0xac09…ff80` |
| Seeder / keeper local | account 1 `0x59c6…690d` |
| e2e burner | account 2 `0x5de4…365a` |

These three must remain distinct on testnet.
