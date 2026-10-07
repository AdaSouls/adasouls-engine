import { compareAmounts, isAmount } from "../amounts.js";
import type { CounterpartyPolicyRules, EvaluationContext } from "../types.js";
import { mergeAmountMap, mergeIntersect, mergeLowerBoundAmount, mergeLowerBoundNumber, mergeUnion, mergeUpperBoundNumber } from "../merge.js";
import type { KindResult } from "./self.js";

export function combineCounterpartyRulesRestrictive(
  a: CounterpartyPolicyRules,
  b: CounterpartyPolicyRules
): CounterpartyPolicyRules {
  return {
    minReputationEvidence: {
      completedActions: mergeLowerBoundNumber(a.minReputationEvidence?.completedActions, b.minReputationEvidence?.completedActions),
      disputeRate: mergeUpperBoundNumber(a.minReputationEvidence?.disputeRate, b.minReputationEvidence?.disputeRate),
    },
    requiredCredentials: mergeUnion(a.requiredCredentials, b.requiredCredentials),
    minTokenHoldings: mergeAmountMap(a.minTokenHoldings, b.minTokenHoldings, mergeLowerBoundAmount),
    minCompletedTransactions: mergeLowerBoundNumber(a.minCompletedTransactions, b.minCompletedTransactions),
    organizationVerification: a.organizationVerification === "required" || b.organizationVerification === "required" ? "required" : undefined,
    // See merge.ts's header comment -- intersection is a safe
    // approximation for combining two "any-of" acceptable-community
    // lists, not an exact decomposition.
    communityMembership: mergeIntersect(a.communityMembership, b.communityMembership),
    allowlist: mergeIntersect(a.allowlist, b.allowlist),
    blocklist: mergeUnion(a.blocklist, b.blocklist),
  };
}

export function evaluateCounterpartyRules(rules: CounterpartyPolicyRules, ctx: EvaluationContext): KindResult {
  const reasons: string[] = [];
  const cp = ctx.counterparty;

  if (rules.blocklist && cp && rules.blocklist.includes(cp.id)) {
    return { outcome: "fail", reasons: [`counterparty "${cp.id}" is on the blocklist`], approvalsRequired: [] };
  }
  if (rules.allowlist && rules.allowlist.length > 0 && (!cp || !rules.allowlist.includes(cp.id))) {
    reasons.push(`counterparty "${cp?.id ?? "unknown"}" is not on the allowlist`);
  }
  if (rules.minReputationEvidence) {
    const { completedActions, disputeRate } = rules.minReputationEvidence;
    const evidence = cp?.reputationEvidence;
    if (completedActions !== undefined && (evidence?.completedActions ?? 0) < completedActions) {
      reasons.push(`counterparty has ${evidence?.completedActions ?? 0} completed actions, requires at least ${completedActions}`);
    }
    if (disputeRate !== undefined && (evidence?.disputeRate ?? 1) > disputeRate) {
      reasons.push(`counterparty dispute rate ${evidence?.disputeRate ?? 1} exceeds max ${disputeRate}`);
    }
  }
  if (rules.requiredCredentials) {
    const missing = rules.requiredCredentials.filter((c) => !(cp?.credentials ?? []).includes(c));
    if (missing.length > 0) reasons.push(`counterparty missing required credentials: ${missing.join(", ")}`);
  }
  if (rules.minTokenHoldings) {
    for (const [asset, min] of Object.entries(rules.minTokenHoldings)) {
      const held = cp?.tokenHoldings?.[asset] ?? "0";
      if (!isAmount(min)) reasons.push(`minTokenHoldings for ${asset} is "${min}", which is not a decimal amount`);
      else if (!isAmount(held) || compareAmounts(held, min) === -1) {
        reasons.push(`counterparty holds ${held} ${asset}, requires at least ${min} ${asset}`);
      }
    }
  }
  if (rules.minCompletedTransactions !== undefined && (cp?.completedTransactions ?? 0) < rules.minCompletedTransactions) {
    reasons.push(`counterparty has ${cp?.completedTransactions ?? 0} completed transactions, requires at least ${rules.minCompletedTransactions}`);
  }
  if (rules.organizationVerification === "required" && !cp?.organizationVerified) {
    reasons.push("counterparty organization is not verified");
  }
  if (rules.communityMembership && rules.communityMembership.length > 0) {
    const member = rules.communityMembership.some((c) => (cp?.communities ?? []).includes(c));
    if (!member) reasons.push(`counterparty is not a member of any required community: ${rules.communityMembership.join(", ")}`);
  }

  return reasons.length > 0
    ? { outcome: "fail", reasons, approvalsRequired: [] }
    : { outcome: "pass", reasons: [], approvalsRequired: [] };
}
