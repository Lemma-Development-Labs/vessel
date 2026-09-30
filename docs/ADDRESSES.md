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
