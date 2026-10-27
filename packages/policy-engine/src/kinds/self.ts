import type { EvaluationContext, SelfPolicyRules, TimeWindow } from "../types.js";
import { addAmounts, compareAmounts, isAmount } from "../amounts.js";
import { mergeAll, mergeAmountMap, mergeIntersect, mergeUpperBound } from "../merge.js";

export function combineSelfRulesRestrictive(a: SelfPolicyRules, b: SelfPolicyRules): SelfPolicyRules {
  return {
    maxTransaction: mergeAmountMap(a.maxTransaction, b.maxTransaction, mergeUpperBound),
    dailySpend: mergeAmountMap(a.dailySpend, b.dailySpend, mergeUpperBound),
    allowedAssets: mergeIntersect(a.allowedAssets, b.allowedAssets),
    allowedProtocols: mergeIntersect(a.allowedProtocols, b.allowedProtocols),
    allowedContracts: mergeIntersect(a.allowedContracts, b.allowedContracts),
    allowedActions: mergeIntersect(a.allowedActions, b.allowedActions),
    // Every window applies, each in its own timezone: the hours allowed
    // are their intersection, and windows that don't overlap allow none.
    timeRestrictions: mergeAll(a.timeRestrictions, b.timeRestrictions),
    humanApprovalThreshold: mergeAmountMap(a.humanApprovalThreshold, b.humanApprovalThreshold, mergeUpperBound),
  };
}

export interface KindResult {
  outcome: "pass" | "fail" | "requires_approval";
  reasons: string[];
  approvalsRequired: string[];
}

/** The hour (0-23) `now` reads in `timezone`, or undefined when the timezone isn't one Intl knows. */
function hourIn(now: Date, timezone: string): number | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).formatToParts(now);
    return Number(parts.find((p) => p.type === "hour")?.value);
  } catch {
    return undefined;
  }
}

function isHour(n: unknown, max: number): n is number {
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;
}

/** Why `now` falls outside `window`, or undefined when it's inside. A window that can't be read denies. */
function outsideWindow(window: TimeWindow, now: Date): string | undefined {
  const timezone = window.timezone ?? "UTC";
  const [start, end] = window.allowedHours ?? [];
  if (!isHour(start, 23) || !isHour(end, 24)) {
    return `timeRestrictions.allowedHours ${JSON.stringify(window.allowedHours)} is not [start hour 0-23, end hour 0-24]`;
  }
  const hour = hourIn(now, timezone);
  if (hour === undefined) return `timeRestrictions.timezone "${timezone}" is not a known timezone`;
  // The end hour is excluded; a start after the end wraps past midnight.
  const inside = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  return inside ? undefined : `hour ${hour} ${timezone} is outside allowedHours [${start}, ${end})`;
}

export function evaluateSelfRules(rules: SelfPolicyRules, ctx: EvaluationContext): KindResult {
  const reasons: string[] = [];
  const { intent } = ctx;

  // A list rule that is set is always checked: an empty list allows
  // nothing, and an intent that leaves the field out is denied rather
  // than let through unchecked.
  if (rules.allowedActions && !rules.allowedActions.includes(intent.capability)) {
    reasons.push(`capability "${intent.capability}" is not in allowedActions [${rules.allowedActions.join(", ")}]`);
  }
  if (rules.allowedAssets) {
    if (!intent.asset) reasons.push(`asset required: allowedAssets is set and the intent has no asset`);
    else if (!rules.allowedAssets.includes(intent.asset)) reasons.push(`asset "${intent.asset}" is not in allowedAssets [${rules.allowedAssets.join(", ")}]`);
  }
  if (rules.allowedProtocols) {
    if (!intent.protocol) reasons.push(`protocol required: allowedProtocols is set and the intent has no protocol`);
    else if (!rules.allowedProtocols.includes(intent.protocol)) reasons.push(`protocol "${intent.protocol}" is not in allowedProtocols [${rules.allowedProtocols.join(", ")}]`);
  }
  if (rules.allowedContracts) {
    if (!intent.contract) reasons.push(`contract required: allowedContracts is set and the intent has no contract`);
    else if (!rules.allowedContracts.includes(intent.contract)) reasons.push(`contract "${intent.contract}" is not in allowedContracts`);
  }
  if (rules.timeRestrictions) {
    const now = ctx.now ?? new Date();
    for (const window of [rules.timeRestrictions].flat()) {
      const outside = outsideWindow(window, now);
      if (outside) reasons.push(outside);
    }
  }

  // Amount rules need to know what is being spent: without an asset or an
  // amount they would otherwise be skipped, so their absence denies.
  const amountRules = (["maxTransaction", "dailySpend", "humanApprovalThreshold"] as const).filter((r) => rules[r] !== undefined);
  if (amountRules.length > 0) {
    if (!intent.asset) reasons.push(`asset required: ${amountRules.join(", ")} ${amountRules.length > 1 ? "are" : "is"} set and the intent has no asset`);
    if (intent.amount === undefined) reasons.push(`amount required: ${amountRules.join(", ")} ${amountRules.length > 1 ? "are" : "is"} set and the intent has no amount`);
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
