import { randomBytes } from "node:crypto";
import type {
  AccountProvider,
  ChainAdapter,
  ExecutionResult,
  ProviderConnectionRef,
  SpendingLimitCheck,
  TransactionStatus,
  TransferRequest,
} from "../types.js";

function randomTxHash(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

export interface MockSpendingLimitConfig {
  /** asset -> remaining allowance, e.g. Safe's Allowance Module would report. */
  remaining?: Record<string, string>;
}

export interface MockAccountProviderOptions {
  spendingLimits?: MockSpendingLimitConfig;
  /** Force the next execute() call's outcome, for testing failure/ambiguous paths deterministically. */
  forceOutcome?: "confirmed" | "failed" | "ambiguous";
}

/**
 * Fully in-memory, deterministic-enough-to-test reference implementation
 * -- what the contract tests run against (Phase 5's "contract tests
 * against a mock provider" requirement), independent of any real
 * network/credentials. Mirrors the same interface contract the real Safe
 * adapter implements, so a caller (a future adasouls-worker) genuinely
 * can't tell the difference except by response content.
 */
export class MockAccountProvider implements AccountProvider {
  private readonly results = new Map<string, ExecutionResult>();

  constructor(private readonly options: MockAccountProviderOptions = {}) {}

  async checkSpendingLimit(_connection: ProviderConnectionRef, request: TransferRequest): Promise<SpendingLimitCheck> {
    const remaining = this.options.spendingLimits?.remaining?.[request.asset];
    if (remaining === undefined) return { allowed: true };
    const allowed = Number(request.amount) <= Number(remaining);
    return {
      allowed,
      reason: allowed ? undefined : `requested ${request.amount} exceeds remaining allowance ${remaining}`,
      remaining,
    };
  }

  async execute(connection: ProviderConnectionRef, request: TransferRequest): Promise<ExecutionResult> {
    const limitCheck = await this.checkSpendingLimit(connection, request);
    if (!limitCheck.allowed) {
      const result: ExecutionResult = { providerRef: randomTxHash(), status: "failed", detail: { reason: limitCheck.reason } };
      this.results.set(result.providerRef, result);
      return result;
    }

    const outcome = this.options.forceOutcome ?? "confirmed";
    const providerRef = randomTxHash();
    const result: ExecutionResult =
      outcome === "ambiguous"
        ? { providerRef, status: "pending", ambiguous: true }
        : outcome === "failed"
          ? { providerRef, status: "failed" }
          : { providerRef, status: "confirmed", txHash: providerRef };

    this.results.set(providerRef, result);
    return result;
  }

  async getStatus(_connection: ProviderConnectionRef, providerRef: string): Promise<ExecutionResult> {
    return this.results.get(providerRef) ?? { providerRef, status: "not_found" };
  }
}

export class MockChainAdapter implements ChainAdapter {
  readonly chain: string;
  private readonly balances = new Map<string, string>();

  constructor(chain = "mock-chain", initialBalances: Record<string, Record<string, string>> = {}) {
    this.chain = chain;
    for (const [address, assets] of Object.entries(initialBalances)) {
      for (const [asset, amount] of Object.entries(assets)) {
        this.balances.set(`${address}:${asset}`, amount);
      }
    }
  }

  async getBalance(address: string, asset: string): Promise<string> {
    return this.balances.get(`${address}:${asset}`) ?? "0";
  }

  async getTransactionStatus(_txHash: string): Promise<TransactionStatus> {
    return "confirmed";
  }
}
