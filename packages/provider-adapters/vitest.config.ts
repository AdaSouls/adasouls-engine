import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Testnet integration tests need real credentials (RPC URL, signer
    // key, a deployed Safe) and aren't run by default -- per
    // adasouls-worker/REPOSITORY.md's documented pattern for provider
    // adapter tests. Run them explicitly with `npm run test:testnet`.
    exclude: ["**/node_modules/**", "**/*.testnet.test.ts"],
  },
});
