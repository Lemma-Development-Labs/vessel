import fs from "node:fs";

const ROOT = process.cwd();
const ADDRESSES_PATH = `${ROOT}/docs/ADDRESSES.md`;
const OUT_STATUS_PATH = `${ROOT}/docs/status.md`;
const OUT_ADDRESSES_PATH = `${ROOT}/docs/resources/addresses.md`;

function parseContractsFromAddressesMd(text) {
  const lines = text.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.includes("| Contract |"));
  const endIdx = lines.findIndex((l) => l.includes("Verified explorer URLs:"));
  const upper = endIdx === -1 ? lines.length : endIdx;

  if (startIdx === -1) return [];

  const rows = [];
  const rowRe = /^\|\s*([^|]+?)\s*\|\s*.*?\b(0x[a-fA-F0-9]{40})\b/;
  for (let i = startIdx + 1; i < upper; i++) {
    const line = lines[i];
    const m = line.match(rowRe);
    if (!m) continue;
    const name = m[1].trim();
    const addr = m[2];
    if (!name || name === "---") continue;
    rows.push({ name, address: addr });
  }

  return rows;
}

function parseShippedHashes(text) {
  // Expected (future) formats:
  // - `| Contract | txHash |`
  // - `- Hull: 0x...` (64 hex chars)
  const map = new Map();

  // Line-based `- Name: <hash>`
  const dashRe = /^-\s*([^:]+?)\s*:\s*(0x[a-fA-F0-9]{64})\s*$/;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(dashRe);
    if (!m) continue;
    map.set(m[1].trim(), m[2]);
  }

  // Table-like
  const pipeRe = /^\|\s*([^|]+?)\s*\|\s*(0x[a-fA-F0-9]{64})\s*\|/;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(pipeRe);
    if (!m) continue;
    map.set(m[1].trim(), m[2]);
  }

  return map;
}

function mdEscape(s) {
  return String(s).replace(/\$/g, "\\$");
}

const addrsMd = fs.readFileSync(ADDRESSES_PATH, "utf8");
const contracts = parseContractsFromAddressesMd(addrsMd);
const shippedHashes = parseShippedHashes(addrsMd);

const statusRows = contracts
  .map((c) => {
    const hash = shippedHashes.get(c.name);
    const live = Boolean(hash);
    return {
      layer: c.name,
      sentence: `Deployed at \`${c.address}\` on Monad testnet.`,
      state: live ? "live" : "simulated",
      hash: live ? hash : "—",
    };
  })
  .sort((a, b) => a.layer.localeCompare(b.layer));

const testnetExplorerBase = "https://testnet.monadvision.com/address/";
const mainnetExplorerBase = "https://monadvision.com/address/";

const addressesRows = contracts
  .map((c) => {
    const hash = shippedHashes.get(c.name);
    const live = Boolean(hash);
    return {
      contract: c.name,
      address: c.address,
      testnetExplorer: `${testnetExplorerBase}${c.address}`,
      mainnetExplorer: `${mainnetExplorerBase}${c.address}`,
      state: live ? "live" : "simulated",
      hash: live ? hash : "—",
    };
  })
  .sort((a, b) => a.contract.localeCompare(b.contract));

function renderStatusMd() {
  return `# /status (generated)

This page is generated from \`docs/ADDRESSES.md\` to keep “live vs simulated” truthful and drift-resistant.

## Table

| Layer | Sentence | Live / Simulated | Hash |
|---|---|---|---|
${statusRows
  .map((r) => `| ${mdEscape(r.layer)} | ${mdEscape(r.sentence)} | ${mdEscape(r.state)} | ${mdEscape(r.hash)} |`)
  .join("\n")}
`;
}

function renderAddressesMd() {
  return `# /resources/addresses (generated)

This page is generated from \`docs/ADDRESSES.md\`.

## Address table

| Contract | Address | Status | Proving tx hash | Testnet explorer | Mainnet explorer |
|---|---|---|---|---|---|
${addressesRows
  .map(
    (r) =>
      `| ${mdEscape(r.contract)} | \`${mdEscape(r.address)}\` | ${mdEscape(r.state)} | ${mdEscape(r.hash)} | ${mdEscape(
        r.testnetExplorer
      )} | ${mdEscape(r.mainnetExplorer)} |`,
  )
  .join("\n")}
`;
}

fs.writeFileSync(OUT_STATUS_PATH, renderStatusMd(), "utf8");
fs.writeFileSync(OUT_ADDRESSES_PATH, renderAddressesMd(), "utf8");

console.log("Generated:");
console.log(`- ${OUT_STATUS_PATH}`);
console.log(`- ${OUT_ADDRESSES_PATH}`);

