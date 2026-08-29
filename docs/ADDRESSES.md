# Address table

Source of truth: [`ADDRESSES.json`](../ADDRESSES.json).

| Contract | Anvil (31337) | Testnet (10143) | Mainnet (143) | Verified |
| --- | --- | --- | --- | --- |
| DemoUSD | see JSON | — | — | no (not broadcast) |
| Guardian | see JSON | — | — | — |
| BlitzVault | see JSON | — | — | — |
| Tranches | see JSON | — | — | — |
| Hull | see JSON | — | — | — |
| Ballast | see JSON | — | — | — |
| SimVenue | see JSON | — | — | — |
| PerplVenue | see JSON | — | — | — |
| EngineLite | see JSON | — | — | — |
| MockWMON | see JSON | — | — | — |
| MockRouter | see JSON | — | — | — |

Verified explorer URLs (once Sourcify is green):

- Testnet: `https://testnet.monadvision.com/address/<addr>`
- Mainnet: `https://monadvision.com/address/<addr>`

Verify runsheet: [docs.monad.xyz/guides/verify-smart-contract](https://docs.monad.xyz/guides/verify-smart-contract). Match `solc 0.8.24` and `optimizer_runs = 200` from `contracts/foundry.toml`. Constructor args via `cast abi-encode`.
