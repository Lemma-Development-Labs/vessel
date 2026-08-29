# Address table

Source of truth: [`ADDRESSES.json`](../ADDRESSES.json).

Broadcast 2026-08-29 on Monad testnet (`chainId` 10143, `deployedBlock` 57874280). Deployer `0x4307C72a92063df4fa189c9e9621b741d457be7C`. Seeder ≠ deployer (venue seed 100 dUSD). Dead shares: 100 dUSD to `0x…dEaD`.

| Contract | Anvil (31337) | Testnet (10143) | Mainnet (143) | Verified |
| --- | --- | --- | --- | --- |
| DemoUSD | re-run Deploy | [`0x7e1Eca4BD693Ca17ADEC1C21cb8a8Cc3edAF6Acc`](https://testnet.monadvision.com/address/0x7e1Eca4BD693Ca17ADEC1C21cb8a8Cc3edAF6Acc) | — | Sourcify |
| Guardian | re-run Deploy | [`0x9f47CA6E0A5B4786362cdBfcCED3710Ea518aa4E`](https://testnet.monadvision.com/address/0x9f47CA6E0A5B4786362cdBfcCED3710Ea518aa4E) | — | Sourcify |
| BlitzVault | re-run Deploy | [`0x4E3C935c69FE55D2A21F1CaB00A95c75F4F85823`](https://testnet.monadvision.com/address/0x4E3C935c69FE55D2A21F1CaB00A95c75F4F85823) | — | Sourcify |
| Tranches | re-run Deploy | [`0x9350A360b01bA4F87Df1164da97Dcc066c37986d`](https://testnet.monadvision.com/address/0x9350A360b01bA4F87Df1164da97Dcc066c37986d) | — | Sourcify |
| Hull | re-run Deploy | [`0xb4C08A9F27a0F64e571f57E633073b4D66680D0d`](https://testnet.monadvision.com/address/0xb4C08A9F27a0F64e571f57E633073b4D66680D0d) | — | Sourcify |
| Ballast | re-run Deploy | [`0x4b37a2c7EeA338832e5F41F75A3F90DC3DffFB33`](https://testnet.monadvision.com/address/0x4b37a2c7EeA338832e5F41F75A3F90DC3DffFB33) | — | Sourcify |
| SimVenue | re-run Deploy | [`0x7E305794712DB9AdBfbe4be5E6CD43C94f7D1bf2`](https://testnet.monadvision.com/address/0x7E305794712DB9AdBfbe4be5E6CD43C94f7D1bf2) | — | Sourcify |
| PerplVenue | re-run Deploy | [`0x4b710a0e4E7767bE65a4821f9b4983Ef10B8E26e`](https://testnet.monadvision.com/address/0x4b710a0e4E7767bE65a4821f9b4983Ef10B8E26e) | — | Sourcify |
| EngineLite | re-run Deploy | [`0x9FB500D00618C27088c439EdE6EED2c6FeB02455`](https://testnet.monadvision.com/address/0x9FB500D00618C27088c439EdE6EED2c6FeB02455) | — | Sourcify |
| MockWMON | re-run Deploy | [`0x4582d715f72221e70A64Af85DF8D9060Be0e1261`](https://testnet.monadvision.com/address/0x4582d715f72221e70A64Af85DF8D9060Be0e1261) | — | Sourcify |
| MockRouter | re-run Deploy | [`0x4D06f69257951B4d5FA4F9D2BF43950d373D9e33`](https://testnet.monadvision.com/address/0x4D06f69257951B4d5FA4F9D2BF43950d373D9e33) | — | Sourcify |

Verified explorer URLs:

- Testnet: `https://testnet.monadvision.com/address/<addr>`
- Mainnet: `https://monadvision.com/address/<addr>`

Verify runsheet: [docs.monad.xyz/guides/verify-smart-contract](https://docs.monad.xyz/guides/verify-smart-contract). Match `solc 0.8.24` and `optimizer_runs = 200` from `contracts/foundry.toml`. Constructor args via `cast abi-encode`.
