import { defineConfig } from "vitest/config";

// Separate config for test:testnet -- the default vitest.config.ts
// excludes *.testnet.test.ts entirely (vitest's `exclude` wins even over
// an explicit filename on the CLI, confirmed while building this), so
// running the testnet suite needs its own config with no such exclude.
export default defineConfig({
  test: {
    include: ["test/safe.testnet.test.ts"],
    testTimeout: 60_000,
  },
});
