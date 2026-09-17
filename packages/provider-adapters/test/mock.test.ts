import { describe, expect, it } from "vitest";
import { MockAccountProvider, MockChainAdapter } from "../src/kinds/mock.js";
import type { ProviderConnectionRef } from "../src/types.js";
import { runAccountProviderContractTests } from "./account-provider.contract.js";

const CONNECTION: ProviderConnectionRef = {
  chain: "mock-chain",
  accountAddress: "0xSafeAddress",
  signer: { privateKey: "0xmocksignerkeydoesnotneedtobevalidhere0000000000000000000000" },
};

runAccountProviderContractTests("MockAccountProvider", () => new MockAccountProvider(), CONNECTION, "USDC");

describe("Phase 5 exit criterion: a simulated USDC transfer executes through the adapter interface", () => {
  it("a transfer within limits confirms", async () => {
    const provider = new MockAccountProvider({ spendingLimits: { remaining: { USDC: "1000" } } });
    const result = await provider.execute(CONNECTION, { to: "0xRecipient", amount: "10", asset: "USDC" });
    expect(result.status).toBe("confirmed");
    expect(result.txHash).toBeTruthy();
  });

  it("independent limit enforcement blocks a transfer exceeding the provider's own allowance, before execution", async () => {
    const provider = new MockAccountProvider({ spendingLimits: { remaining: { USDC: "5" } } });
    const check = await provider.checkSpendingLimit(CONNECTION, { to: "0xRecipient", amount: "10", asset: "USDC" });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("exceeds remaining allowance");

    const result = await provider.execute(CONNECTION, { to: "0xRecipient", amount: "10", asset: "USDC" });
    expect(result.status).toBe("failed");
  });

  it("an ambiguous outcome is reported as its own distinct case, not folded into pending or failed silently", async () => {
    const provider = new MockAccountProvider({ forceOutcome: "ambiguous" });
    const result = await provider.execute(CONNECTION, { to: "0xRecipient", amount: "1", asset: "USDC" });
    expect(result.ambiguous).toBe(true);
    expect(result.status).toBe("pending");
  });
});

describe("MockChainAdapter", () => {
  it("reports a configured balance", async () => {
    const chain = new MockChainAdapter("mock-chain", { "0xAddr": { USDC: "42" } });
    expect(await chain.getBalance("0xAddr", "USDC")).toBe("42");
  });

  it("reports zero for an unconfigured address/asset", async () => {
    const chain = new MockChainAdapter();
    expect(await chain.getBalance("0xUnknown", "USDC")).toBe("0");
  });
});
