import type { EvaluationContext, SelfPolicyRules } from "../types.js";
import { mergeAmountMap, mergeIntersect, mergeUpperBound } from "../merge.js";

export function combineSelfRulesRestrictive(a: SelfPolicyRules, b: SelfPolicyRules): SelfPolicyRules {
  return {
    maxTransaction: mergeAmountMap(a.maxTransaction, b.maxTransaction, mergeUpperBound),
    dailySpend: mergeAmountMap(a.dailySpend, b.dailySpend, mergeUpperBound),
    allowedAssets: mergeIntersect(a.allowedAssets, b.allowedAssets),
    allowedProtocols: mergeIntersect(a.allowedProtocols, b.allowedProtocols),
    allowedContracts: mergeIntersect(a.allowedContracts, b.allowedContracts),
    allowedActions: mergeIntersect(a.allowedActions, b.allowedActions),
    // Two independent time windows don't reduce to one generically (their
    // true AND could be a non-contiguous set of hours) -- narrower
    // window wins as a reasonable approximation, flagged rather than
    // silently assumed correct in all cases.
    timeRestrictions:
      a.timeRestrictions && b.timeRestrictions
        ? a.timeRestrictions.allowedHours[1] - a.timeRestrictions.allowedHours[0] <=
          b.timeRestrictions.allowedHours[1] - b.timeRestrictions.allowedHours[0]
          ? a.timeRestrictions
          : b.timeRestrictions
        : (a.timeRestrictions ?? b.timeRestrictions),
    humanApprovalThreshold: mergeAmountMap(a.humanApprovalThreshold, b.humanApprovalThreshold, mergeUpperBound),
  };
}

export interface KindResult {
  outcome: "pass" | "fail" | "requires_approval";
  reasons: string[];
  approvalsRequired: string[];
}

export function evaluateSelfRules(rules: SelfPolicyRules, ctx: EvaluationContext): KindResult {
  const reasons: string[] = [];
  const { intent } = ctx;

  if (rules.allowedActions && !rules.allowedActions.includes(intent.capability)) {
    reasons.push(`capability "${intent.capability}" is not in allowedActions [${rules.allowedActions.join(", ")}]`);
  }
  if (rules.allowedAssets && intent.asset && !rules.allowedAssets.includes(intent.asset)) {
    reasons.push(`asset "${intent.asset}" is not in allowedAssets [${rules.allowedAssets.join(", ")}]`);
  }
  if (rules.allowedProtocols && intent.protocol && !rules.allowedProtocols.includes(intent.protocol)) {
    reasons.push(`protocol "${intent.protocol}" is not in allowedProtocols [${rules.allowedProtocols.join(", ")}]`);
  }
  if (rules.allowedContracts && intent.contract && !rules.allowedContracts.includes(intent.contract)) {
    reasons.push(`contract "${intent.contract}" is not in allowedContracts`);
  }
  if (rules.timeRestrictions && ctx.now) {
    // Simplified: UTC hour only, no real per-timezone conversion -- a
    // known limitation, not silently glossed over.
    const hour = ctx.now.getUTCHours();
    const [start, end] = rules.timeRestrictions.allowedHours;
    if (hour < start || hour > end) {
      reasons.push(`hour ${hour} UTC is outside allowedHours [${start}, ${end}]`);
    }
  }

  let approvalsRequired: string[] = [];

  if (intent.asset && intent.amount !== undefined) {
    const max = rules.maxTransaction?.[intent.asset];
    if (max !== undefined && Number(intent.amount) > Number(max)) {
      reasons.push(`amount ${intent.amount} ${intent.asset} exceeds maxTransaction ${max} ${intent.asset}`);
    }

    const dailyLimit = rules.dailySpend?.[intent.asset];
    if (dailyLimit !== undefined) {
      const spentSoFar = Number(ctx.dailySpendSoFar?.[intent.asset] ?? "0");
      const projected = spentSoFar + Number(intent.amount);
      if (projected > Number(dailyLimit)) {
        reasons.push(`projected daily spend ${projected} ${intent.asset} exceeds dailySpend limit ${dailyLimit} ${intent.asset}`);
      }
    }

    const approvalThreshold = rules.humanApprovalThreshold?.[intent.asset];
    if (reasons.length === 0 && approvalThreshold !== undefined && Number(intent.amount) > Number(approvalThreshold)) {
      approvalsRequired = ["human_approval"];
    }
  }

  if (reasons.length > 0) return { outcome: "fail", reasons, approvalsRequired: [] };
  if (approvalsRequired.length > 0) return { outcome: "requires_approval", reasons: [], approvalsRequired };
  return { outcome: "pass", reasons: [], approvalsRequired: [] };
}
