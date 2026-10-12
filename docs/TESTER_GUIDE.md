# Vessel testnet — tester guide

Thanks for testing Vessel. This guide gets you from an empty wallet to a deposit, and shows you how
to watch it work and get your money back out. It takes about 15 minutes the first time.

**Everything here is on Monad testnet. Nothing has real value, nothing is audited, and you should
never send real funds.**

## What Vessel is

Vessel is delta-neutral, two-tranche yield on Monad. Deposits are put to work in a hedge: the book
holds MON and shorts the same amount of MON on Perpl, so MON's price moves cancel out and the book
earns the funding the short collects. You choose your risk:

- **Hull**: a senior tranche at a fixed rate (8% on testnet, for illustration) for a 28-day term.
  Hull is paid first.
- **Ballast**: the first-loss tranche. Ballast absorbs losses before Hull does, and in return keeps
  whatever the book earns above Hull's rate.

### What's real and what's simulated on this testnet

| Part | Status |
| --- | --- |
| Your deposits, claims and withdrawals (Circle testnet USDC) | Real testnet contracts |
| The MON short on Perpl, its margin and funding | Real testnet venue |
| Kuru trading and the USDC ⇄ AUSD conversion | Real testnet contracts |
| The MON spot leg | **Simulated.** It uses vMON, a Vessel test token priced at Perpl's live MON price, because enough testnet MON was not available |
| Prices | From Perpl's mark, not yet an independent oracle |

The app labels the simulated spot leg in amber wherever it appears.

## 1. Set up your wallet (once)

1. Install **MetaMask** in Chrome. If the Coinbase Wallet extension is also installed, turn it off
   while testing: the two clash and MetaMask can fail to open.
2. Add **Monad Testnet**: the app will offer to add and switch to it when you connect. You can also
   add it from [faucet.monad.xyz](https://faucet.monad.xyz/add-network).
3. Send us the wallet address you will test with. **Only invited addresses can deposit.** Invites go
   out in waves.

## 2. Get test funds (once, then as needed)

You need two things, both free:

1. **MON for gas.** Every action is a transaction, including the first approval. Get a little from
   [faucet.monad.xyz](https://faucet.monad.xyz) (or the Alchemy or QuickNode Monad faucets). 1 MON
   lasts a long time.
2. **Circle testnet USDC.** This is what you deposit. Go to
   [faucet.circle.com](https://faucet.circle.com), choose **Monad Testnet**, paste your address and
   request. You get **20 USDC every 2 hours**.

Use only Circle's USDC. Other tokens called "USDC" on testnet will not work.

## 3. Deposit

Open the app link from your invite and go to **Deposit**.

1. **Connect** your wallet and check the address is the one you were invited with.
2. Check the top: your **USDC balance** should show what you got from the faucet.
3. Choose a tranche:
   - **Ballast**: open whenever the book is accepting deposits. Requests are admitted in queue order.
   - **Hull**: open only during a series' **72-hour subscription window**. Everyone in the window
     is admitted together, at the same rate, when it closes (up to 25 subscribers).
4. Enter an amount and submit. Your wallet asks **twice**:
   1. **approve** exactly that amount of USDC for Vessel's custody contract;
   2. send the **deposit request**.

A deposit is a request first: your USDC waits in custody until it is admitted. Ballast is
usually admitted by the keeper within a few minutes. If a request is not admitted (for example, the
book is full), it becomes a refund you can claim from **Portfolio**.

Messages you may see:
- *"Hull is full for now — Ballast capacity must grow first (20% floor)"*: Hull can only grow
  while Ballast stays at least 20% of the book. Try Ballast, or wait for more Ballast.
- *"Above your beta allowance"*: each invited address has a lifetime limit.

## 4. Watch it work

- **Portfolio** shows your Ballast units and their current value, your Hull positions, and anything
  you can claim.
- **Transparency** shows the whole book: Hull, Ballast and reserve; the engine's MON spot (vMON) and
  MON short; the independent on-chain checks; and every contract, with a link to its verified source.
- **Terminal** is the detailed view: the hedge, the price source and the trade limits.

The engine starts hedging once the book is big enough to trade in its minimum slice size, so early on
you may see the book's money held as cash in the engine. That is expected.

## 5. Get your money out

### Ballast

1. Go to **Withdraw**, enter an amount (or MAX) and submit.
2. Your exit enters a queue with a **48-hour cooldown**. Your units stay exposed to the book until
   the exit is paid, so the amount you receive reflects the book at that time. You set a minimum
   you will accept.
3. After the cooldown, the keeper funds exits in order, unwinding part of the hedge if it needs
   cash. An exit can be paid in parts. If it waits, you may see *"Exit queued by the floor"*:
   Ballast protects Hull, so exits pause while Ballast is at its 20% floor.
4. When it shows as claimable in **Portfolio**, **claim** it to receive USDC in your wallet.

### Hull

Hull has no early exit during its 28-day term. At maturity the book funds every Hull holder
together, and you **claim** principal plus coupon from **Portfolio**.

## 6. If something goes wrong

| What you see | What to do |
| --- | --- |
| Wallet won't open or the connect button does nothing | Turn off other wallet extensions (Coinbase Wallet), reload, connect again |
| "Wrong network" | Switch your wallet to Monad Testnet |
| Not enough MON for gas | Get MON from the Monad faucet; approvals and requests both need gas |
| USDC balance is 0 after using the faucet | Check you chose **Monad Testnet** on faucet.circle.com and used the same address |
| *"price moved — try again"* | Prices moved between your quote and the transaction; submit again |
| A transaction is pending for a long time | Leave the page open; the app picks it up again after a reload |

When you report a problem, include your wallet address, the page, what you clicked, and the
transaction hash if there is one (your wallet shows it).

## Good to know

- Testnet only: no real money, no mainnet, and no independent security review yet.
- Your claims cannot be transferred to another wallet during the beta.
- The numbers in the app are read directly from the chain; anything the app cannot read is shown as
  unavailable, never as zero.
