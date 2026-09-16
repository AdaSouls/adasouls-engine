export const POLICY_KINDS = ["self", "counterparty", "market", "execution"] as const;
export type PolicyKind = (typeof POLICY_KINDS)[number];

/** Evaluation order per docs/11-policy-model.md -- fixed, not configurable. */
export const POLICY_EVALUATION_ORDER: readonly PolicyKind[] = ["self", "counterparty", "market", "execution"];

export interface PolicyScope {
  agentId?: string;
  organizationId?: string;
}

// -- Rule shapes, one per kind, matching the YAML examples in 11-policy-model.md --

export interface SelfPolicyRules {
  maxTransaction?: Record<string, string>; // asset -> max amount
  dailySpend?: Record<string, string>; // asset -> max cumulative daily amount
  allowedAssets?: string[];
  allowedProtocols?: string[];
  allowedContracts?: string[];
  allowedActions?: string[]; // capabilities
  timeRestrictions?: { timezone: string; allowedHours: [number, number] };
  humanApprovalThreshold?: Record<string, string>; // asset -> amount above which approval is required
}

export interface CounterpartyPolicyRules {
  minReputationEvidence?: { completedActions?: number; disputeRate?: number };
  requiredCredentials?: string[];
  minTokenHoldings?: Record<string, string>;
  minCompletedTransactions?: number;
  organizationVerification?: "required";
  communityMembership?: string[];
  allowlist?: string[];
  blocklist?: string[];
}

export interface MarketPolicyRules {
  maxPrice?: { perRequest?: string }; // "<amount> <asset>", e.g. "1 USDC"
  allowedCurrencies?: string[];
  minSLA?: { successRate?: number };
  maxSlippage?: number;
}

export interface ExecutionPolicyRules {
  allowedChains?: string[];
  allowedWalletProviders?: string[];
  allowedPaymentRails?: string[];
  allowedProtocols?: string[];
}

export type RulesFor<K extends PolicyKind> = K extends "self"
  ? SelfPolicyRules
  : K extends "counterparty"
    ? CounterpartyPolicyRules
    : K extends "market"
      ? MarketPolicyRules
      : ExecutionPolicyRules;

export interface Policy<K extends PolicyKind = PolicyKind> {
  id: string;
  kind: K;
  version: number;
  scope: PolicyScope;
  rules: RulesFor<K>;
}

// -- Evaluation context: what evaluatePolicy needs about the attempted action --

export interface CounterpartyContext {
  id: string;
  reputationEvidence?: { completedActions: number; disputeRate: number };
  credentials?: string[];
  tokenHoldings?: Record<string, string>;
  completedTransactions?: number;
  organizationVerified?: boolean;
  communities?: string[];
  /** Historical success rate, for market policy's minSLA check. */
  successRate?: number;
}

export interface IntentContext {
  capability: string;
  asset?: string;
  amount?: string; // decimal string, e.g. "10"
  protocol?: string;
  contract?: string;
  chain?: string;
  walletProvider?: string;
  paymentRail?: string;
  /** "<amount> <asset>", matching maxPrice.perRequest's format, for market-policy price checks. */
  price?: string;
  slippage?: number;
}

export interface EvaluationContext {
  agentId: string;
  intent: IntentContext;
  counterparty?: CounterpartyContext;
  /** Cumulative spend so far today, per asset -- policy-engine has no persistence (per its own non-responsibilities), the caller supplies this. */
  dailySpendSoFar?: Record<string, string>;
  /** Injectable clock, for deterministic time-restriction tests. */
  now?: Date;
}

// -- Result shape, per 11-policy-model.md "Result shape (used everywhere)" --

export type PolicyOutcome = "pass" | "fail" | "requires_approval";

export interface MatchedPolicy {
  policyId: string;
  kind: PolicyKind;
  outcome: PolicyOutcome;
}

export interface PolicyEvaluation {
  allowed: boolean;
  reasons: string[];
  approvalsRequired: string[];
  matchedPolicies: MatchedPolicy[];
}
