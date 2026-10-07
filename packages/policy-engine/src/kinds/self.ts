import type { EvaluationContext, SelfPolicyRules } from "../types.js";
import { addAmounts, compareAmounts, isAmount } from "../amounts.js";
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
    const asset = intent.asset;
    // Anything that isn't a plain decimal amount denies: an amount or a
    // limit that can't be read is never treated as zero or as no limit.
    const limit = (name: string, value: string | undefined): string | undefined => {
      if (value !== undefined && !isAmount(value)) reasons.push(`${name} for ${asset} is "${value}", which is not a decimal amount`);
      return value !== undefined && isAmount(value) ? value : undefined;
    };
    const max = limit("maxTransaction", rules.maxTransaction?.[asset]);
    const dailyLimit = limit("dailySpend", rules.dailySpend?.[asset]);
    const approvalThreshold = limit("humanApprovalThreshold", rules.humanApprovalThreshold?.[asset]);

    if (!isAmount(intent.amount)) {
      reasons.push(`amount "${intent.amount}" is not a decimal amount`);
    } else {
      const amount = intent.amount;
      if (max !== undefined && compareAmounts(amount, max) === 1) {
        reasons.push(`amount ${amount} ${asset} exceeds maxTransaction ${max} ${asset}`);
      }
      if (dailyLimit !== undefined) {
        const spentSoFar = ctx.dailySpendSoFar?.[asset] ?? "0";
        if (!isAmount(spentSoFar)) {
          reasons.push(`the amount of ${asset} spent so far today ("${spentSoFar}") is not a decimal amount`);
        } else {
          const projected = addAmounts(spentSoFar, amount);
          if (compareAmounts(projected, dailyLimit) === 1) {
            reasons.push(`projected daily spend ${projected} ${asset} exceeds dailySpend limit ${dailyLimit} ${asset}`);
          }
        }
      }
      if (reasons.length === 0 && approvalThreshold !== undefined && compareAmounts(amount, approvalThreshold) === 1) {
        approvalsRequired = ["human_approval"];
      }
    }
  }

  if (reasons.length > 0) return { outcome: "fail", reasons, approvalsRequired: [] };
  if (approvalsRequired.length > 0) return { outcome: "requires_approval", reasons: [], approvalsRequired };
  return { outcome: "pass", reasons: [], approvalsRequired: [] };
}
