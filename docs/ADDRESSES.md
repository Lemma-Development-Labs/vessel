# Address table

Source of truth: [`ADDRESSES.json`](../ADDRESSES.json).

Broadcast 2026-08-29 on Monad testnet (`chainId` 10143, `deployedBlock` 57923009). Deployer `0xFfae50A3Ecc660fFF2B83e0B75F52c0A5F4E0F78`, owner Safe `0xe4f24B16CFF9171f555E4643262991023b5C0279`. Seeder ≠ deployer (venue seed 100 dUSD). Dead shares: 100 dUSD to `0x…dEaD`.

| Contract | Anvil (31337) | Testnet (10143) | Mainnet (143) | Verified |
| --- | --- | --- | --- | --- |
| DemoUSD | re-run Deploy | [`0x959E54DcF8576856F7A9424190a9751c68739495`](https://testnet.monadvision.com/address/0x959E54DcF8576856F7A9424190a9751c68739495) | — | Sourcify |
| Guardian | re-run Deploy | [`0x75Bf4C326f054e655C7C138cD847154fEB3bAC19`](https://testnet.monadvision.com/address/0x75Bf4C326f054e655C7C138cD847154fEB3bAC19) | — | Sourcify |
| BlitzVault | re-run Deploy | [`0x27eE1688F8b07E2aa767a4B4f4b90040E3ABC55d`](https://testnet.monadvision.com/address/0x27eE1688F8b07E2aa767a4B4f4b90040E3ABC55d) | — | Sourcify |
| Tranches | re-run Deploy | [`0x7Df78EA918FA4531a74b79CE0a53a6D94B72E373`](https://testnet.monadvision.com/address/0x7Df78EA918FA4531a74b79CE0a53a6D94B72E373) | — | Sourcify |
| Hull | re-run Deploy | [`0x9638da84aA4b30fB9350bb2cA33DCf0b81Ab3Bd2`](https://testnet.monadvision.com/address/0x9638da84aA4b30fB9350bb2cA33DCf0b81Ab3Bd2) | — | Sourcify |
| Ballast | re-run Deploy | [`0xCD694B5C79D12708F11FB1adF1594e8e71de650D`](https://testnet.monadvision.com/address/0xCD694B5C79D12708F11FB1adF1594e8e71de650D) | — | Sourcify |
| SimVenue | re-run Deploy | [`0xD8730205Ab716Bc2FcA2FfF653e1390DFC4Fe85d`](https://testnet.monadvision.com/address/0xD8730205Ab716Bc2FcA2FfF653e1390DFC4Fe85d) | — | Sourcify |
| PerplVenue | re-run Deploy | [`0x59fc4C09eF7Dc0b754B74d7AEe21EeAC1c94aD6C`](https://testnet.monadvision.com/address/0x59fc4C09eF7Dc0b754B74d7AEe21EeAC1c94aD6C) | — | Sourcify |
| EngineLite | re-run Deploy | [`0x60eC904955CA843285B24E3F6e7e2034F8f96140`](https://testnet.monadvision.com/address/0x60eC904955CA843285B24E3F6e7e2034F8f96140) | — | Sourcify |
| MockWMON | re-run Deploy | [`0xEf6Cc6228A39cF8433754dcBe863275AC6Dc5DB5`](https://testnet.monadvision.com/address/0xEf6Cc6228A39cF8433754dcBe863275AC6Dc5DB5) | — | Sourcify |
| MockRouter | re-run Deploy | [`0x68A1Ad5FB46c3Eb804F3375Cba702d806E1890B6`](https://testnet.monadvision.com/address/0x68A1Ad5FB46c3Eb804F3375Cba702d806E1890B6) | — | Sourcify |

Verified explorer URLs:

- Testnet: `https://testnet.monadvision.com/address/<addr>`
- Mainnet: `https://monadvision.com/address/<addr>`

Verify runsheet: [docs.monad.xyz/guides/verify-smart-contract](https://docs.monad.xyz/guides/verify-smart-contract). Match `solc 0.8.24` and `optimizer_runs = 200` from `contracts/foundry.toml`. Constructor args via `cast abi-encode`.

## v2 core — Monad testnet (2026-10-01)

Source of truth: [`deployments/testnet-v2.json`](../deployments/testnet-v2.json)
(release manifest, schema v1). Block 67163430. Deployer
`0x64d81F3E47c9Ba737BE17f8F9E5398EBf7e9Ce86` (no role after deploy). Governance: Safe
`0xe4f24B16CFF9171f555E4643262991023b5C0279` → TimelockController (300 s; proposer,
executor and canceller = Safe; deployer holds no timelock role). Guardian =
Safe (pause only). Operator (v2 keeper) `0xd1588b68d6beac5328E61166b952619b63dbf16f`. Asset =
DemoUSD above. Engine is **SIMULATED**; G01–G04 BLOCKED; not audited.

| Contract | Testnet (10143) | Deploy | Verified |
| --- | --- | --- | --- |
| TimelockController | [`0xe687b7e1C2F346f2Ad6ebA9C58c3e71C24430097`](https://testnet.monadvision.com/address/0xe687b7e1C2F346f2Ad6ebA9C58c3e71C24430097) | [tx](https://testnet.monadvision.com/tx/0xe73e385b8f4426093c98c62b7cbf48c1d440267f9393f008c3a78de4e3c18b92) | Sourcify exact |
| PauseGuardian | [`0x7bB3eaAdbc82114A9EA4533577D6fb7f3Fad58A1`](https://testnet.monadvision.com/address/0x7bB3eaAdbc82114A9EA4533577D6fb7f3Fad58A1) | [tx](https://testnet.monadvision.com/tx/0x53eb4a7d21dedb3d79ce23501ac9dc56dadd4135e4d88ca209059a0184ab1770) | Sourcify exact |
| TrancheController | [`0x33EC27A870debF8D8565256A972448530589d37F`](https://testnet.monadvision.com/address/0x33EC27A870debF8D8565256A972448530589d37F) | [tx](https://testnet.monadvision.com/tx/0x2a20d7e6950140795755470f80819be8f93a7c5ad000ced4ca90c66c4017766d) | Sourcify exact |
| AssetCustody | [`0xfd7F4687890aDC7463f6b94b2DCdCcBD19f588c5`](https://testnet.monadvision.com/address/0xfd7F4687890aDC7463f6b94b2DCdCcBD19f588c5) | created by TrancheController | Sourcify exact |
| ClaimEscrow | [`0xf34A3F1bDb949361faF11c5a2A2063A832AdC1cF`](https://testnet.monadvision.com/address/0xf34A3F1bDb949361faF11c5a2A2063A832AdC1cF) | created by TrancheController | Sourcify exact |
| BallastToken | [`0x86A5Bb9eD956069c79D24CC51A60f68DC1EAaAFd`](https://testnet.monadvision.com/address/0x86A5Bb9eD956069c79D24CC51A60f68DC1EAaAFd) | created by TrancheController | Sourcify exact |
| SimulatedEngine | [`0x0137903a9308cC675c13E5aB935c27707eE4Be6A`](https://testnet.monadvision.com/address/0x0137903a9308cC675c13E5aB935c27707eE4Be6A) | [tx](https://testnet.monadvision.com/tx/0x06e3ed434bbc612e1c0688b466e6bfece9f04fd7e172f769cf67a31c7a26ed19) | Sourcify exact |

Reserve seed: 20 dUSD sent to the timelock
([tx](https://testnet.monadvision.com/tx/0x375b264f42e07dd71dde48b1b8b6b31aac39b63100b31de984a68b31938c80de)).
Wiring (engine, caps, reserve, funding rate) is pending Safe batch 01 —
see [`deployments/README.md`](../deployments/README.md).
