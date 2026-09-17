import { describe, expect, it } from "vitest";
import { SafeAccountProvider } from "../src/kinds/safe.js";
import { BaseSepoliaChainAdapter, BASE_SEPOLIA_PUBLIC_RPC } from "../src/kinds/base-sepolia-chain.js";
import type { ProviderConnectionRef } from "../src/types.js";
import { runAccountProviderContractTests } from "./account-provider.contract.js";

/**
 * Real testnet integration test -- per Phase 5's "one real integration
 * test against the testnet/sandbox" requirement. NOT run by default
 * (excluded in vitest.config.ts, and this file isn't imported by
 * test.ts) -- needs real credentials, same pattern
 * adasouls-worker/REPOSITORY.md documents for provider adapter tests.
 *
 * Setup (see README.md):
 *   1. npm run deploy:testnet-safe -- deploys a 1-of-1 Safe you own
 *   2. Fund that Safe with a little testnet USDC (a Base Sepolia USDC
 *      faucet, or bridge/swap a small amount)
 *   3. TESTNET_SIGNER_PRIVATE_KEY=0x... TESTNET_SAFE_ADDRESS=0x...
 *      npm run test:testnet
 */
const privateKey = process.env.TESTNET_SIGNER_PRIVATE_KEY as `0x${string}` | undefined;
const safeAddress = process.env.TESTNET_SAFE_ADDRESS;
// Base Sepolia's canonical USDC (Circle-issued test USDC). Confirmed via
// eth_getCode against the public RPC that this address has real contract
// code matching an upgradeable-proxy pattern (consistent with how Circle
// deploys USDC) -- not independently confirmed to actually be USDC
// specifically (would need a real transfer to fully prove that).
const USDC_BASE_SEPOLIA = process.env.TESTNET_USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

if (!privateKey || !safeAddress) {
  describe.skip("SafeAccountProvider (testnet) -- skipped, set TESTNET_SIGNER_PRIVATE_KEY and TESTNET_SAFE_ADDRESS to run", () => {
    it("skipped", () => {});
  });
} else {
  const connection: ProviderConnectionRef = {
    chain: "base-sepolia",
    accountAddress: safeAddress,
    signer: { privateKey },
  };

  runAccountProviderContractTests("SafeAccountProvider (real Base Sepolia)", () => new SafeAccountProvider(), connection, USDC_BASE_SEPOLIA);

  describe("Phase 5 exit criterion, for real: a simulated (testnet) USDC transfer executes through the adapter interface", () => {
    it("executes a real USDC transfer on Base Sepolia and the status is eventually confirmed", async () => {
      const provider = new SafeAccountProvider();
      const result = await provider.execute(connection, { to: safeAddress, amount: "0.01", asset: USDC_BASE_SEPOLIA });
      expect(result.providerRef).toBeTruthy();
      console.log(`Executed: ${result.providerRef} (status: ${result.status})`);

      // Poll for confirmation -- testnet blocks aren't instant.
      const chain = new BaseSepoliaChainAdapter(BASE_SEPOLIA_PUBLIC_RPC);
      let status = result.status;
      for (let i = 0; i < 10 && status !== "confirmed" && status !== "failed"; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        status = await chain.getTransactionStatus(result.providerRef);
      }
      expect(status).toBe("confirmed");
    }, 60_000);
  });
}
