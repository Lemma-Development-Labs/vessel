# Deployments

Release manifests and governance batches for the v2 core (ADR-008 testnet
build). Nothing here holds keys or sends transactions by itself.

## Testnet v2 — runbook

Rehearsed end to end on a local chain (2026-09-30): script broadcast → Safe
files generated from these specs → schedule → execute refused before the delay
→ execute → on-chain state checked.

1. **Deploy** (deployer keeps no role; needs `contracts/.env` with a fresh,
   funded `DEPLOYER_PK` — never paste keys into chat or commit them):

   ```bash
   cd contracts && set -a && source .env && set +a
   V2_SAFE=0x12B2A61ac4108C722A6Dd1530fb7142cE9BD2Ee5 \
   V2_OPERATOR=<keeper address> \
   V2_ASSET=0x959E54DcF8576856F7A9424190a9751c68739495 \
   V2_TIMELOCK_DELAY=300 V2_MANIFEST_OUT=../deployments/testnet-v2.json \
   forge script script/DeployV2.s.sol:DeployV2 --rpc-url $MONAD_TESTNET_RPC --broadcast --slow
   ```

   Writes `deployments/testnet-v2.json` (schema v1). Verify on Sourcify
   afterwards.

2. **Reserve seed:** send 20 dUSD to the `TimelockController` address.

3. **Governance batch 01** (wire engine, caps, reserve, simulated funding):

   ```bash
   node scripts/v2-governance-batch.mjs deployments/governance/testnet-v2-01-wire.json
   ```

   In the Safe UI → Transaction Builder → import
   `testnet-v2-01-wire.schedule.safe.json`, collect 2 of 3 signatures,
   execute. After the timelock delay, import and execute
   `testnet-v2-01-wire.execute.safe.json` the same way.

4. **Batch 03 — allowances:** copy the TEMPLATE, fill tester wallets, same flow.

5. **Batch 02 — open Hull series 1** when Ballast and the reserve can cover it
   (activation refuses subscriptions that would break projected 30% cover).

The testnet timelock delay is 5 minutes so the 3-day build can configure the
book; spec governance is 48 hours, and the mainnet guard refuses anything
shorter (Session 8).

## Files

| File | Meaning |
|---|---|
| `testnet-v2.json` | Release manifest written by `DeployV2` (after the testnet deploy) |
| `governance/*.json` | Batch specs (human-readable intent) |
| `governance/*.safe.json` | Generated Safe Transaction Builder files — regenerate, never hand-edit |

## Switching to a new governance Safe

The v2 contracts bind their Safe immutably (timelock proposer/executor,
guardian, fee treasury), so a new Safe means a new deployment. One command
does it from the signer **addresses** — no signer key is ever needed:

```bash
# 1. rehearse on a local fork of testnet (nothing sent, repo untouched)
scripts/v2-switch-safe.sh 0xSigner1,0xSigner2,0xSigner3 --rehearse
# 2. real run
scripts/v2-switch-safe.sh 0xSigner1,0xSigner2,0xSigner3
```

It creates a 2-of-3 Safe (v1.4.1 SafeL2, same configuration as before; the
deployer is refused as a signer), archives the old manifest to
`deployments/superseded/`, deploys the v2 core governed by the new Safe with
the same keeper, sends the 20 dUSD reserve seed, regenerates batches 01/02
and every app/SDK/MCP binding, verifies sources on Sourcify, refreshes the
verification badges from Sourcify's records, and runs `vessel-verify`.
The rehearsal additionally plays the Safe through batch 01 (schedule →
refused before the delay → execute) and checks the wired state.
