# Address table

Source of truth: [`ADDRESSES.json`](../ADDRESSES.json).

Broadcast 2026-08-29 on Monad testnet (`chainId` 10143, `deployedBlock` 57874280). Deployer `0x85Fe6D9399EA584Ba5344b8d21e27137adbB5738`. Seeder ≠ deployer (venue seed 100 dUSD). Dead shares: 100 dUSD to `0x…dEaD`.

| Contract | Anvil (31337) | Testnet (10143) | Mainnet (143) | Verified |
| --- | --- | --- | --- | --- |
| DemoUSD | re-run Deploy | [`0x66B5A41466b1Ab2dE34Bf3834b26F99bA4f52e05`](https://testnet.monadvision.com/address/0x66B5A41466b1Ab2dE34Bf3834b26F99bA4f52e05) | — | Sourcify |
| Guardian | re-run Deploy | [`0x150e153D5aB4683EC576bC1F68b7839D86751208`](https://testnet.monadvision.com/address/0x150e153D5aB4683EC576bC1F68b7839D86751208) | — | Sourcify |
| BlitzVault | re-run Deploy | [`0xE1c3aBAd2789aC170833d9E9bd72E706284a70c5`](https://testnet.monadvision.com/address/0xE1c3aBAd2789aC170833d9E9bd72E706284a70c5) | — | Sourcify |
| Tranches | re-run Deploy | [`0xdb4666c3F187e73795bcF9Cfb3a6D64A875EF842`](https://testnet.monadvision.com/address/0xdb4666c3F187e73795bcF9Cfb3a6D64A875EF842) | — | Sourcify |
| Hull | re-run Deploy | [`0xC053Fc6968BAd0FB03094E002a4F4EC74a746f12`](https://testnet.monadvision.com/address/0xC053Fc6968BAd0FB03094E002a4F4EC74a746f12) | — | Sourcify |
| Ballast | re-run Deploy | [`0x074207acEf2f60a6B1B86a885D2fF893927109A1`](https://testnet.monadvision.com/address/0x074207acEf2f60a6B1B86a885D2fF893927109A1) | — | Sourcify |
| SimVenue | re-run Deploy | [`0xAbE34e4919e7Ffd5C87D5B62d35f7E7Bb4e50FD7`](https://testnet.monadvision.com/address/0xAbE34e4919e7Ffd5C87D5B62d35f7E7Bb4e50FD7) | — | Sourcify |
| PerplVenue | re-run Deploy | [`0xaf1C0BdEaF91273E18a80bF80afD8A5C6d497C21`](https://testnet.monadvision.com/address/0xaf1C0BdEaF91273E18a80bF80afD8A5C6d497C21) | — | Sourcify |
| EngineLite | re-run Deploy | [`0xDE65E58df3e3da55DD3c6e107E30E1655Fb5fC85`](https://testnet.monadvision.com/address/0xDE65E58df3e3da55DD3c6e107E30E1655Fb5fC85) | — | Sourcify |
| MockWMON | re-run Deploy | [`0x17141F36c4401C6184143250827713b26c3E964F`](https://testnet.monadvision.com/address/0x17141F36c4401C6184143250827713b26c3E964F) | — | Sourcify |
| MockRouter | re-run Deploy | [`0x23389cA2fbf11f9D0159EF2F80A963E710c5F97C`](https://testnet.monadvision.com/address/0x23389cA2fbf11f9D0159EF2F80A963E710c5F97C) | — | Sourcify |

# Shipped hashes

At the time of this scaffold, no proving tx hashes have been appended yet.
`/status` and `/resources/addresses` therefore render these contracts as **simulated**
until this section contains entries.

```
# Shipped hashes
# TX_KURU_SPOT   <pending>   —   2026-09-04   blocked: MON-USDC bestAsk=0 @ block 59560667; no DEPLOYER_PK in this agent env
```

Kuru logo / “spot on Kuru” copy stays **off** until `TX_KURU_SPOT` is a real
vault-path fill hash. MockRouter remains the live testnet spot adapter until then.

Verified explorer URLs:

- Testnet: `https://testnet.monadvision.com/address/<addr>`
- Mainnet: `https://monadvision.com/address/<addr>`

Verify runsheet: [docs.monad.xyz/guides/verify-smart-contract](https://docs.monad.xyz/guides/verify-smart-contract). Match `solc 0.8.24` and `optimizer_runs = 200` from `contracts/foundry.toml`. Constructor args via `cast abi-encode`.
