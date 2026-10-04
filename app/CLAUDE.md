# Vessel app — binding design law

Do not restyle ad hoc. If a screen needs a new color, it is using the system wrong.

## Tokens

One system with vessel.wtf: the values below are `vessel-landing/tokens.css` (the
landing repo is the source; change them there first).

| Token | Hex | Role |
| --- | --- | --- |
| `--bg` (void) | `#05070A` | Page base |
| `--bg2` / `--panel` | `#0B1015` | Raised surfaces |
| `--line` | `rgba(244,241,234,0.12)` | Hairlines — warm, never a solid grey (`--line-soft` .08, `--line-strong` .16) |
| `--text` (bone) | `#F4F1EA` | Primary text, the mark, primary buttons |
| `--text-dim` | `#A9B4C0` | Body copy |
| `--steel` | `#8A96A3` | Labels, nav, secondary text |
| `--hull` (delta) | `#6BF2C0` | Hull / senior, links, connect |
| `--ballast` (signal) | `#FF5B29` | Ballast / junior, the plumb — one accent per view |
| `--phosphor` | `#6BF2C0` | Live / positive data — never decorative |
| `--amber` | `#F0B35C` | Testnet / warnings |
| `--red` | `#E5646C` | Errors / negative funding |
| `--deep` | `#2C5CFF` | Atmosphere only, never type |

Atmosphere: void base with a fixed layer of faint 64px grid plus three glows (deep top
right, signal bottom left, delta below) — `body::before` in `app/globals.css`. No shadows
except the hover glow on primary and connect buttons. Corners are square (2px); only pills
and status dots are round.

Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64. Content shell 1320px, 30px gutter.

## Type

Two faces, no more:

- **Archivo** (variable width) — every word set as prose or headline. Headlines and section
  titles use `.display`: weight 800, `wdth` 110–115, uppercase, tight negative tracking.
  Page titles (`PageHead`) end on one accent line in `--hull`, or `--ballast` only where
  Ballast is the subject.
- **IBM Plex Mono** — EVERY number, address, hash, rate, timestamp, label, nav item and
  button. Labels and buttons are uppercase with wide tracking (.14–.26em). `tabular-nums`.

dUSD: 4 decimal places in tables, 2 in summaries.

## Color-by-role (honesty)

- Hull is delta mint, still (zero motion). That stillness means protected.
- Ballast is signal orange on a warm panel. One faint shimmer on hover only (1.2s).
  Reduced-motion: no shimmer.
- Phosphor (the same mint) is for live numbers, not chrome.
- Simulated venue is always an amber outlined chip. Never look "mainnet live".
- The landing page's demo figures (OI hedged, funding today, venue rows) are marketing
  placeholders. The app never shows a number it did not read (Rule 0).

## Honesty chrome (every route)

- Thin amber banner, derived by `lib/banner.ts` (spec §15): `TESTNET · NO REAL VALUE · NO INDEPENDENT REVIEW` — the last part is the *actual* review status. Mainnet is `PRIVATE MAINNET BETA · REAL FUNDS AT RISK · <review scope + date>` on red, and never says no-real-value.
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
Visible focus rings: 2px `--hull`.
No layout shift on data load — skeletons sized to content.

## Provider

Screens consume `VesselDataProvider` only for protocol data. Mock only when `NEXT_PUBLIC_USE_MOCK=1` exactly (`lib/mock-flag.ts`); anything else is Chain. Do not special-case screens for chain.

Exception — identity: wallet connection for sign-in and the SIWE session use wagmi and `lib/auth.ts` directly (`/onboarding`, the session chip). Mock mode fakes chain *data*, never the user's wallet or session, so these must stay real in both modes.
