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
// deploys USDC), and that Circle's faucet funds a Safe with it on Base
// Sepolia, where it was transferred through the Allowance Module.
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

  /**
   * The Lock level, for real: a signer that is a delegate of the
   * Allowance Module and NOT an owner of the Safe. Needs, on top of the
   * setup above:
   *   - the batch from `npm run apply-limits` signed by the Safe's owner
   *     (so the module is enabled and the delegate has a USDC allowance);
   *   - the delegate's address funded with a little Base Sepolia ETH (it
   *     pays its own gas);
   *   - TESTNET_DELEGATE_PRIVATE_KEY=0x...
   * The same path was run against a real Safe on 2026-10-07 (see the
   * README). These cases need an allowance with something left of it.
   */
  const delegateKey = process.env.TESTNET_DELEGATE_PRIVATE_KEY as `0x${string}` | undefined;
  (delegateKey ? describe : describe.skip)("the agent's signer as an Allowance Module delegate", () => {
    const delegated: ProviderConnectionRef = { chain: "base-sepolia", accountAddress: safeAddress, signer: { privateKey: delegateKey! } };

    it("reports the on-chain allowance, and that a contract enforces it", async () => {
      const check = await new SafeAccountProvider().checkSpendingLimit(delegated, { to: safeAddress, amount: "0.01", asset: USDC_BASE_SEPOLIA });
      expect(check.enforcedBy).toBe("allowance-module");
      expect(check.allowed).toBe(true);
      console.log(`Left of the on-chain allowance: ${check.remaining}`);
    });

    it("moves funds through the module, within the allowance", async () => {
      const result = await new SafeAccountProvider().execute(delegated, { to: safeAddress, amount: "0.01", asset: USDC_BASE_SEPOLIA });
      expect(result.path).toBe("allowance-module");
      console.log(`Executed through the module: ${result.providerRef}`);
    }, 60_000);

    it("the contract refuses a transfer over what is left, and nothing is broadcast", async () => {
      const provider = new SafeAccountProvider();
      const check = await provider.checkSpendingLimit(delegated, { to: safeAddress, amount: "1000000000", asset: USDC_BASE_SEPOLIA });
      expect(check.allowed).toBe(false);
      await expect(provider.execute(delegated, { to: safeAddress, amount: "1000000000", asset: USDC_BASE_SEPOLIA })).rejects.toThrow();
    }, 60_000);
  });
}
