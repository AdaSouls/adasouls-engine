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
  /** One window, or several that must ALL hold -- combining policies produces the list. */
  timeRestrictions?: TimeWindow | TimeWindow[];
  humanApprovalThreshold?: Record<string, string>; // asset -> amount above which approval is required
}

/**
 * Hours of the day an action may happen in, in `timezone` (an IANA name,
 * UTC when omitted). The start hour is included and the end hour is not:
 * [9, 17] allows 09:00 to 16:59. A start after the end wraps past
 * midnight: [22, 6] allows 22:00 to 05:59. [0, 24] is the whole day, and
 * a start equal to the end allows no hour at all.
 */
export interface TimeWindow {
  timezone?: string;
  allowedHours: [number, number];
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
  /** Whom the counterparty acts for: the ALMA ids of the organizations or people it may belong to. */
  allowedPrincipals?: string[];
  blockedPrincipals?: string[];
}

export interface MarketPolicyRules {
  /**
   * "<amount> <asset>", e.g. "1 USDC", or one such cap per asset. Once any
   * cap is set, a price in an asset without one is denied: prices are
   * never converted between assets.
   */
  maxPrice?: { perRequest?: string | string[] };
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
  /** The ALMA id of the organization or person the counterparty acts for. Absent when nobody is known to answer for it. */
  principalId?: string;
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
  /** Injectable clock, for deterministic time-restriction tests. Defaults to the current time. */
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
  /**
   * true only when the action is authorized outright -- nothing denied
   * it AND no approval is needed. false covers both a hard deny and a
   * needs-approval outcome; the caller distinguishes those by checking
   * approvalsRequired.length (per docs/06-api-contracts.md's dry-run
   * example and docs/10-economic-action-lifecycle.md's three-way
   * created -> rejected | pending_approval | authorized state machine).
   * Do NOT treat `allowed` alone as "go ahead" -- a caller that does
   * skips the approval gate entirely.
   */
  allowed: boolean;
  reasons: string[];
  approvalsRequired: string[];
  matchedPolicies: MatchedPolicy[];
}
