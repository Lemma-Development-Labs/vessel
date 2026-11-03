import { defineConfig } from "vitest/config";

// Several tests boot PGlite (WASM Postgres), which can take over vitest's 5 s default on a loaded or
// throttled machine; that, not the code, failed the history test in the 25 Oct review (OPS-2).
export default defineConfig({
  test: { testTimeout: 30_000 },
});
