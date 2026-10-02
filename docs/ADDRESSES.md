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

## v2 core — Monad testnet (2026-10-02)

Source of truth: [`deployments/testnet-v2.json`](../deployments/testnet-v2.json)
(release manifest, schema v1). Block 67565062. Deployer
`0x64d81F3E47c9Ba737BE17f8F9E5398EBf7e9Ce86` (no role after deploy).

Governance: Safe [`0x12B2A61ac4108C722A6Dd1530fb7142cE9BD2Ee5`](https://testnet.monadvision.com/address/0x12B2A61ac4108C722A6Dd1530fb7142cE9BD2Ee5)
(v1.4.1 SafeL2, 2 of 3: `0x8824E59f75A09852f5d17A48d973F89E9299f254`, `0x70d6D2dfccE6888E1f22939A81Cd1d38AfcC2019`, `0x8370F0d005dD380Be21C60048a87f8de519eD0c7`;
[created](https://testnet.monadvision.com/tx/0x5587381869d1f0734d0c5e7851a6efe22c0347224fa23c000f23ef3c37e250d0) by the deployer from signer
addresses — [`deployments/testnet-safe.json`](../deployments/testnet-safe.json))
→ TimelockController (300 s; proposer, executor and canceller = Safe). Guardian = Safe
(pause only). Operator (v2 keeper) `0xd1588b68d6beac5328E61166b952619b63dbf16f`. Asset = DemoUSD above.
Engine is **SIMULATED**; G01–G04 BLOCKED; not audited.

The three signers currently share one MetaMask recovery phrase (build phase); control
passes to the team by replacing signers on the Safe — tracked under G07.

| Contract | Testnet (10143) | Deploy | Verified |
| --- | --- | --- | --- |
| TimelockController | [`0xA75526e97f0b0f5d2f9B06f0eD0C7DB9545A9f80`](https://testnet.monadvision.com/address/0xA75526e97f0b0f5d2f9B06f0eD0C7DB9545A9f80) | [tx](https://testnet.monadvision.com/tx/0xb9e47e4d4e0ed0cbfd01be78147010161061fcaf08fe9be6af689e09589fbea0) | Sourcify exact |
| PauseGuardian | [`0x6B12C7375FC96dc2f805Cd1e28999b711d1C3e17`](https://testnet.monadvision.com/address/0x6B12C7375FC96dc2f805Cd1e28999b711d1C3e17) | [tx](https://testnet.monadvision.com/tx/0x622868ada18f43c6db82f5bbc72a000620126efede98897cba21bd6b03325fd9) | Sourcify exact |
| TrancheController | [`0x717147E566C42D8926c258fCe24B1746ceDB1740`](https://testnet.monadvision.com/address/0x717147E566C42D8926c258fCe24B1746ceDB1740) | [tx](https://testnet.monadvision.com/tx/0x55832c0d17255963e61e83bb5c91c0bbf02a0df19044179ef850bc08ea64e20b) | Sourcify exact |
| AssetCustody | [`0x800b830A3B6C63bcAABAa9128A217a03aaD7377d`](https://testnet.monadvision.com/address/0x800b830A3B6C63bcAABAa9128A217a03aaD7377d) | created by TrancheController | Sourcify exact |
| ClaimEscrow | [`0x6B60BcdF3a2DB8762Ade4b05D590aB0aCf0FDF3d`](https://testnet.monadvision.com/address/0x6B60BcdF3a2DB8762Ade4b05D590aB0aCf0FDF3d) | created by TrancheController | Sourcify exact |
| BallastToken | [`0x278E531dBc080Fa4C0314da9c1592bA6f148926d`](https://testnet.monadvision.com/address/0x278E531dBc080Fa4C0314da9c1592bA6f148926d) | created by TrancheController | Sourcify exact |
| SimulatedEngine | [`0x2174EBa2b5b20B6CA128FD2BCfc74A9c0736ffED`](https://testnet.monadvision.com/address/0x2174EBa2b5b20B6CA128FD2BCfc74A9c0736ffED) | [tx](https://testnet.monadvision.com/tx/0x6d4088c05e54f891617cab4b72e5af13e50164751230da4b337a9157e743735c) | Sourcify exact |

Reserve seed: 20 dUSD sent to the timelock. Wiring (engine, caps, reserve, funding
rate) is pending Safe batch 01 — see [`deployments/README.md`](../deployments/README.md).

Superseded 2026-10-02: the first v2 deployment (block 67163430, governed by the
previous Safe `0xe4f2…0279`, whose keys the team retired) — manifest kept at
[`deployments/superseded/testnet-v2-block67163430.json`](../deployments/superseded/testnet-v2-block67163430.json).
Nothing points at it.
