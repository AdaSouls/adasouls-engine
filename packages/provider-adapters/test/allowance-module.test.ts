import { describe, expect, it } from "vitest";
import { decodeFunctionData, getAddress } from "viem";
import { compileLimits, type ApplyLimitsInput } from "../src/apply-limits.js";
import { ALLOWANCE_MODULE_ABI, ALLOWANCE_MODULE_BASE_SEPOLIA, MAX_UINT96, SAFE_MODULE_ABI, parseTokenAllowance, remainingAllowance } from "../src/kinds/allowance-module.js";

const SAFE = "0x1111111111111111111111111111111111111111";
const DELEGATE = "0x2222222222222222222222222222222222222222";
const OWNER = "0x3333333333333333333333333333333333333333";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const MINUTE = 60;

describe("what a delegate can still move", () => {
  // 500 USDC a day, 120 spent, period started at minute 1000.
  const allowance = parseTokenAllowance([500_000000n, 120_000000n, 1440n, 1000n, 3n]);

  it("names the module's five numbers", () => {
    expect(allowance).toEqual({ amount: 500_000000n, spent: 120_000000n, resetTimeMin: 1440, lastResetMin: 1000, nonce: 3 });
    expect(() => parseTokenAllowance([1n, 2n])).toThrow();
  });

  it("is the allowance less what was spent, within the period", () => {
    expect(remainingAllowance(allowance, 1000 * MINUTE)).toBe(380_000000n);
    expect(remainingAllowance(allowance, (1000 + 1439) * MINUTE)).toBe(380_000000n);
  });

  it("is the whole allowance again once a full period has passed, as the contract computes it", () => {
    expect(remainingAllowance(allowance, (1000 + 1440) * MINUTE)).toBe(500_000000n);
  });

  it("never comes back for a one-time allowance", () => {
    const once = { ...allowance, resetTimeMin: 0 };
    expect(remainingAllowance(once, (1000 + 100_000) * MINUTE)).toBe(380_000000n);
  });

  it("is zero, never negative, when the allowance was lowered below what was spent", () => {
    expect(remainingAllowance({ ...allowance, amount: 100_000000n }, 1000 * MINUTE)).toBe(0n);
  });
});

describe("apply-limits: declared limits as Safe transactions", () => {
  const input = (over: Partial<ApplyLimitsInput> = {}): ApplyLimitsInput => ({
    chainId: 84532,
    safe: SAFE,
    delegate: DELEGATE,
    allowanceModule: ALLOWANCE_MODULE_BASE_SEPOLIA,
    moduleEnabled: false,
    dailySpend: { USDC: "500" },
    maxTransaction: { USDC: "100" },
    humanApprovalThreshold: { USDC: "50" },
    tokens: { USDC: { address: USDC, decimals: 6 } },
    owners: [OWNER],
    createdAt: 1_790_000_000_000,
    ...over,
  });

  it("enables the module, adds the delegate and sets one daily allowance per asset", () => {
    const { batch, allowances } = compileLimits(input());
    expect(batch).toMatchObject({ version: "1.0", chainId: "84532", meta: { createdFromSafeAddress: SAFE } });
    expect(batch.transactions.map((t) => [t.contractMethod.name, t.to])).toEqual([
      ["enableModule", SAFE],
      ["addDelegate", ALLOWANCE_MODULE_BASE_SEPOLIA],
      ["setAllowance", ALLOWANCE_MODULE_BASE_SEPOLIA],
    ]);
    expect(batch.transactions.every((t) => t.value === "0")).toBe(true);

    // The calldata says exactly what the readable fields say.
    expect(decodeFunctionData({ abi: SAFE_MODULE_ABI, data: batch.transactions[0].data }).args).toEqual([ALLOWANCE_MODULE_BASE_SEPOLIA]);
    expect(decodeFunctionData({ abi: ALLOWANCE_MODULE_ABI, data: batch.transactions[1].data }).args).toEqual([DELEGATE]);
    const set = decodeFunctionData({ abi: ALLOWANCE_MODULE_ABI, data: batch.transactions[2].data });
    expect(set.functionName).toBe("setAllowance");
    expect(set.args).toEqual([DELEGATE, getAddress(USDC), 500_000000n, 1440, 0]);
    expect(batch.transactions[2].contractInputsValues).toEqual({ delegate: DELEGATE, token: getAddress(USDC), allowanceAmount: "500000000", resetTimeMin: "1440", resetBaseMin: "0" });
    expect(allowances).toEqual([{ asset: "USDC", token: getAddress(USDC), amount: "500", baseUnits: "500000000", resetMinutes: 1440 }]);
  });

  it("doesn't enable a module that is already enabled", () => {
    expect(compileLimits(input({ moduleEnabled: true })).batch.transactions.map((t) => t.contractMethod.name)).toEqual(["addDelegate", "setAllowance"]);
  });

  it("says what the chain will not enforce", () => {
    const notes = compileLimits(input({ hasCounterpartyPolicy: true })).notes.join("\n");
    expect(notes).toContain("maxTransaction 100 USDC is NOT enforced by the chain");
    expect(notes).toContain("whole 500 USDC allowance in one transfer");
    expect(notes).toContain("human-approval threshold is NOT enforced");
    expect(notes).toContain("counterparty policy is NOT enforced");
    expect(compileLimits(input()).notes.join("\n")).toContain("can pay any address");
  });

  it("an asset with a per-transaction limit and no daily limit gets no allowance, and says so", () => {
    const out = compileLimits(input({ maxTransaction: { USDC: "100", DAI: "10" } }));
    expect(out.allowances.map((a) => a.asset)).toEqual(["USDC"]);
    expect(out.notes.join("\n")).toContain("DAI has a per-transaction limit and no daily limit");
  });

  it("refuses to make an owner the delegate", () => {
    expect(() => compileLimits(input({ owners: [OWNER, DELEGATE.toUpperCase().replace("0X", "0x")] }))).toThrow("is an owner of the Safe");
    expect(() => compileLimits(input({ delegate: SAFE }))).toThrow("can't be the Safe itself");
  });

  it("refuses what it can't turn into an exact allowance", () => {
    expect(() => compileLimits(input({ dailySpend: {} }))).toThrow("no dailySpend limit");
    expect(() => compileLimits(input({ dailySpend: { DAI: "5" } }))).toThrow("no token address is known for DAI");
    for (const amount of ["1e3", "", "-5", "five hundred"]) expect(() => compileLimits(input({ dailySpend: { USDC: amount } })), amount).toThrow("not a decimal amount");
    expect(() => compileLimits(input({ dailySpend: { USDC: "0.0000001" } }))).toThrow("only 6 decimals");
    expect(() => compileLimits(input({ dailySpend: { USDC: "0" } }))).toThrow("is zero");
    expect(() => compileLimits(input({ dailySpend: { USDC: (MAX_UINT96 + 1n).toString() } }))).toThrow("larger than the module can hold");
    expect(() => compileLimits(input({ safe: "0x123" }))).toThrow();
  });
});
