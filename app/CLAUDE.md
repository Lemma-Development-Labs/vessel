# Vessel app — binding design law

Do not restyle ad hoc. If a screen needs a new color, it is using the system wrong.

## Tokens

| Token | Hex | Role |
| --- | --- | --- |
| `--bg` | `#070B10` | Page top |
| `--bg2` | `#0B1118` | Page bottom / cards |
| `--panel` | `#0E131B` | Raised panel |
| `--line` | `rgba(255,255,255,0.12)` | Hairlines |
| `--text` | `#EAEEF3` | Body |
| `--text-dim` | `rgba(234,238,243,0.62)` | Dim copy |
| `--purple` | `#836EF9` | **Primary actions and links ONLY** |
| `--brass` | `#C9964B` | Ballast / risk ONLY |
| `--steel` | `#8FA6BC` | Hull ONLY |
| `--phosphor` | `#35D699` | Live / positive data ONLY — never decorative |
| `--amber` | `#F0B35C` | Testnet / warnings |
| `--red` | `#E5646C` | Errors / negative funding |

Page background is a vertical gradient `bg → bg2`. Shadows: none. Depth is borders and background steps.

Radii: cards 16px (designed app), chips 8px, modals 16px.
Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64.

## Type

- **Bricolage Grotesque** — display: page titles, card titles, labels of big numbers
- **Instrument Sans** — body / UI
- **IBM Plex Mono** — EVERY number, address, hash, rate, timestamp. `tabular-nums`. No exceptions.

dUSD: 4 decimal places in tables, 2 in summaries.

## Color-by-role (honesty)

- Hull is steel, still (zero motion). That stillness means protected.
- Ballast is brass. One faint shimmer on hover only (1.2s). Reduced-motion: no shimmer.
- Phosphor is for live numbers, not chrome.
- Simulated venue is always an amber outlined chip. Never look "mainnet live".

## Honesty chrome (every route)

- Thin amber banner: `TESTNET — demo assets, unaudited contracts.`
- SIM VENUE chip when SimVenue is active
- Footer legal line includes **unaudited**
- dUSD is demo dollars. Never call it USDC.

## Copy (do not paraphrase)

- SubordinationFloor toast: `Ballast must stay at or above 20% of deck TVL. Join Ballast or exit Hull.`
- Hull floor tooltip: `Hull is full for now — Ballast capacity must grow first (20% floor)`
- Ballast exit tooltip: `Exit queued by the floor — Ballast is what protects Hull. Capacity frees as Hull exits or Ballast grows.`
- FaucetCooldown: `Faucet cooldown — {mm}:{ss} remaining`
- HullImpairment: `HULL IMPAIRMENT — halted`
- Slippage: `price moved — try again`

## Motion

`prefers-reduced-motion: reduce` — no shimmer, no gauge jitter, waterfall renders final rows only.
Visible focus rings: 2px `--purple`.
No layout shift on data load — skeletons sized to content.

## Provider

Screens consume `VesselDataProvider` only. Mock (`NEXT_PUBLIC_USE_MOCK≠0`) vs Chain (`=0`). Do not special-case screens for chain.
