import type { EvaluationContext, ExecutionPolicyRules } from "../types.js";
import { mergeIntersect } from "../merge.js";
import type { KindResult } from "./self.js";

export function combineExecutionRulesRestrictive(a: ExecutionPolicyRules, b: ExecutionPolicyRules): ExecutionPolicyRules {
  return {
    allowedChains: mergeIntersect(a.allowedChains, b.allowedChains),
    allowedWalletProviders: mergeIntersect(a.allowedWalletProviders, b.allowedWalletProviders),
    allowedPaymentRails: mergeIntersect(a.allowedPaymentRails, b.allowedPaymentRails),
    allowedProtocols: mergeIntersect(a.allowedProtocols, b.allowedProtocols),
  };
}

export function evaluateExecutionRules(rules: ExecutionPolicyRules, ctx: EvaluationContext): KindResult {
  const reasons: string[] = [];
  const { intent } = ctx;

  // An allow-list that is set is always checked: an empty list allows
  // nothing, and an intent that leaves the field out is denied.
  const check = (rule: string, list: string[] | undefined, field: string, value: string | undefined) => {
    if (!list) return;
    if (!value) reasons.push(`${field} required: ${rule} is set and the intent has no ${field}`);
    else if (!list.includes(value)) reasons.push(`${field} "${value}" is not in ${rule} [${list.join(", ")}]`);
  };
  check("allowedChains", rules.allowedChains, "chain", intent.chain);
  check("allowedWalletProviders", rules.allowedWalletProviders, "walletProvider", intent.walletProvider);
  check("allowedPaymentRails", rules.allowedPaymentRails, "paymentRail", intent.paymentRail);
  check("allowedProtocols", rules.allowedProtocols, "protocol", intent.protocol);

  return reasons.length > 0
    ? { outcome: "fail", reasons, approvalsRequired: [] }
    : { outcome: "pass", reasons: [], approvalsRequired: [] };
}
