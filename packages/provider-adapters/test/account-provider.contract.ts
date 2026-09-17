import { describe, expect, it } from "vitest";
import type { AccountProvider, ProviderConnectionRef } from "../src/types.js";

/**
 * The AccountProvider contract, runnable against any implementation --
 * per Phase 5's "contract tests against a mock provider" requirement.
 * Reused for both MockAccountProvider (test/mock.test.ts, runs always)
 * and SafeAccountProvider (test/safe.testnet.test.ts, needs real
 * testnet credentials, not run by default).
 */
export function runAccountProviderContractTests(
  name: string,
  makeProvider: () => AccountProvider,
  connection: ProviderConnectionRef,
  transferableAsset: string
) {
  describe(`AccountProvider contract: ${name}`, () => {
    it("execute() returns a providerRef that getStatus() can look up", async () => {
      const provider = makeProvider();
      const result = await provider.execute(connection, { to: connection.accountAddress, amount: "1", asset: transferableAsset });
      expect(result.providerRef).toBeTruthy();

      const status = await provider.getStatus(connection, result.providerRef);
      expect(status.providerRef).toBe(result.providerRef);
      expect(["pending", "confirmed", "failed"]).toContain(status.status);
    });

    it("getStatus() on an unknown providerRef doesn't throw", async () => {
      const provider = makeProvider();
      const status = await provider.getStatus(connection, "definitely-not-a-real-ref");
      expect(status.status).toBeDefined();
    });

    it("checkSpendingLimit() returns an explainable result, not a bare boolean", async () => {
      const provider = makeProvider();
      const result = await provider.checkSpendingLimit(connection, { to: connection.accountAddress, amount: "1", asset: transferableAsset });
      expect(typeof result.allowed).toBe("boolean");
    });
  });
}
