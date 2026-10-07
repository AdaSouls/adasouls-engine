/**
 * Interfaces per ADR-006 (provider-agnostic execution) and
 * docs/09-custody-and-key-management.md's provider category table.
 * economic-core/policy-engine never reference a specific provider by
 * name; this package is the only place that does.
 *
 * Phase 5 implements two of the nine interfaces named in ADR-006
 * (WalletProvider, SignerProvider, AccountProvider, ChainAdapter,
 * PaymentProvider, ProtocolAdapter, IdentityProvider, RPCProvider,
 * IndexerProvider) -- the roadmap's own phase table says
 * "WalletProvider, ChainAdapter" as a generic shorthand, but Safe is a
 * smart account, not an embedded/managed wallet -- per
 * docs/09-custody-and-key-management.md's table it's AccountProvider,
 * which is what's actually implemented here. The other seven interfaces
 * are out of scope until a provider that needs them is integrated
 * (ADR-011-style "do not build before there's a concrete need").
 */

/**
 * A reference to a customer-owned provider connection -- never a raw
 * credential. AdaSouls stores exactly this shape in adasouls-api's
 * ProviderConnection table (docs/05-data-ownership.md); the actual
 * signer credential a connection references lives in Secrets Manager,
 * resolved by the caller and handed to the adapter per-call, never
 * cached here.
 */
export interface ProviderConnectionRef {
  /** Which chain this connection operates on, e.g. "base-sepolia". */
  chain: string;
  /** The account address (e.g. a Safe address). */
  accountAddress: string;
  /**
   * Resolved signer credential for THIS call only -- the caller (
   * adasouls-worker, eventually) resolves the Secrets Manager reference
   * and passes the material in; this package never stores or logs it
   * beyond the single call it's used in (docs/08-security-model.md).
   */
  signer: { privateKey: `0x${string}` };
}

export interface TransferRequest {
  to: string;
  amount: string;
  /** Asset contract address, or "native" for the chain's native token. */
  asset: string;
}

export type TransactionStatus = "pending" | "confirmed" | "failed" | "not_found";

export interface ExecutionResult {
  /** The provider's own identifier for this attempt (a Safe transaction hash, a chain tx hash, etc.) -- opaque to the caller, passed back into getStatus(). */
  providerRef: string;
  status: TransactionStatus;
  txHash?: string;
  /**
   * Ambiguous outcome (submitted but not yet confirmed, or the provider
   * couldn't say definitively) -- surfaced as its own distinct case per
   * 09-custody-and-key-management.md's failure-semantics onboarding
   * requirement, not silently folded into "pending" or "failed" so the
   * caller (a future adasouls-worker) can reconcile deliberately
   * (10-economic-action-lifecycle.md's needsReconciliation).
   */
  ambiguous?: boolean;
  /**
   * How the transfer left the account, for a smart account that has more
   * than one way. "owner": signed as one of the account's owners, which
   * no on-chain limit applies to. "allowance-module": signed as a
   * delegate, capped by the module contract.
   */
  path?: "owner" | "allowance-module";
  detail?: Record<string, unknown>;
}

export interface SpendingLimitCheck {
  allowed: boolean;
  reason?: string;
  /** The remaining allowance the provider itself enforces, if it can report one -- independent of AdaSouls's own policy-engine check. */
  remaining?: string;
  /** Set when a contract enforces this limit, not only reports it. Absent: nothing on chain caps this signer. */
  enforcedBy?: "allowance-module";
}

/**
 * Smart accounts (Safe) -- per 09-custody-and-key-management.md's table.
 * Not WalletProvider (embedded/managed wallets like Crossmint/Privy) --
 * a smart account's authorization model is its own on-chain logic
 * (multisig threshold, modules), not an API-key-gated custodian.
 */
export interface AccountProvider {
  /**
   * Independent limit enforcement (onboarding requirement #3) -- checked
   * BEFORE attempting execution, using whatever spend-limit mechanism
   * the provider itself enforces (Safe's Allowance Module, for the Safe
   * implementation), not merely trusted at the application layer.
   * Returns { allowed: true } when the provider has no such mechanism
   * configured -- this is a real check, not a rubber stamp, but it's
   * additive to (never a replacement for) policy-engine's own check.
   */
  checkSpendingLimit(connection: ProviderConnectionRef, request: TransferRequest): Promise<SpendingLimitCheck>;
  execute(connection: ProviderConnectionRef, request: TransferRequest): Promise<ExecutionResult>;
  getStatus(connection: ProviderConnectionRef, providerRef: string): Promise<ExecutionResult>;
}

/** Chain-level reads, independent of which account/provider is acting -- per ADR-006. */
export interface ChainAdapter {
  chain: string;
  getBalance(address: string, asset: string): Promise<string>;
  getTransactionStatus(txHash: string): Promise<TransactionStatus>;
}
