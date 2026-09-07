# Vessel CRE workflow

See [`docs/CRE.md`](../docs/CRE.md) for fact-check, dual-path design, and the
submission “why CRE” paragraph.

```bash
export PATH="$HOME/.cre/bin:$HOME/.bun/bin:$PATH"
bun install
bun test
# after cre login:
cre workflow simulate . --target local-settings --allow-insecure-rpc
```

Deployment is Early Access — do not imply a live DON until `cre account access`
is approved and `cre execution list` shows runs.
