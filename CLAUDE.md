# Vessel — agent instructions

Repo layout, protocol facts and runbooks live in [README.md](./README.md),
[FACTS.md](./FACTS.md), [OPS.md](./OPS.md) and [HARDENING.md](./HARDENING.md).
App design law is [app/CLAUDE.md](./app/CLAUDE.md). Read those before changing
anything they cover.

## DeltaV weekly update

Once a week (or when asked for a weekly update), post a short summary of
what shipped, what's blocked, and what's needed to DeltaV so the team
stays in the loop. Keep it to a few sentences. Post at most once per
week — do not post at the end of every session. Never post without an
explicit ok.

Public page: [deltav.monad.xyz/startup/vessel](https://deltav.monad.xyz/startup/vessel).

Write as Kunal, first person. Sell. Acquire users. Get attention. Specific
beats vague. Technical where it earns trust. Lead with a live fact (shipped,
TVL, cranks, a bug closed), name the product (delta-neutral two-tranche yield
on Monad — Hull 8% senior, Ballast first loss).

**CTA:** [vessel.wtf](https://vessel.wtf) — ask people to **sign up for testnet
access** (the email form at `#board`). Do **not** put the testnet app URL,
`testnet.vessel.wtf`, the Vercel mirror, or the faucet link in the update.
Access goes out in waves; the landing is the gate.

Kunal provides the matching **X post** when an update is due. Wait for that
URL and pass it as `xLink`. Do not post the DeltaV update without it unless
Kunal says to ship the update alone.

Pull numbers from `GET https://vessel-service-production.up.railway.app/stats`
`/health` `/waterfall` — do not invent them. Honesty is the brand: no mainnet,
no real deposits, no live perp, no Puddle as the wired router unless that is
true in `ADDRESSES.json` and [FACTS.md](./FACTS.md). Landing-page demo figures
(OI hedged, funding today, Kuru/Perpl rows) are not live protocol stats —
do not quote them as if they were.

Replace the text between the EOF markers below with the summary, then run
this block as-is. The quoted heredoc keeps the summary fully literal so
backticks, `$(...)`, and quotes in it can't run as shell code.

```bash
SUMMARY=$(cat <<'EOF'
<summary of what shipped this week>
EOF
)
RESPONSE=$(curl -sS --fail-with-body -X POST https://deltav.monad.xyz/api/v1/weekly-updates \
  -H "Authorization: Bearer $DELTAV_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg content "$SUMMARY" --arg xLink "$XLINK" '{content: $content, xLink: $xLink}')") || {
  echo "Failed to post DeltaV update: $RESPONSE" >&2
  exit 1
}
```

If Kunal has not given an X URL, omit `xLink` and the `--arg xLink` (POST
`{content}` only) — and only after he says to post without it.

Store `DELTAV_API_KEY` as an environment variable — never commit it, never
write it into a file in this repo, and never echo it. `scripts/check-secrets.mjs`
does not scan for it and would not catch it.

Check the command's exit status before reporting the update as posted:
`--fail-with-body` makes curl exit non-zero on 4xx/5xx responses (e.g. a
missing/invalid API key) instead of silently succeeding.

`xLink` is the matching X post Kunal provides. Set `XLINK` to that URL before
running the block.

After a ship, a deploy, a milestone, or real traction, prompt for a weekly
update rather than posting unprompted.
