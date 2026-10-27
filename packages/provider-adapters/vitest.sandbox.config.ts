import { defineConfig } from "vitest/config";

// For test:stripe -- the default config excludes *.sandbox.test.ts, for
// the same reason as vitest.testnet.config.ts.
export default defineConfig({
  test: {
    include: ["test/*.sandbox.test.ts"],
    testTimeout: 30_000,
  },
});
