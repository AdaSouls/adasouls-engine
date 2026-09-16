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

  if (rules.allowedChains && intent.chain && !rules.allowedChains.includes(intent.chain)) {
    reasons.push(`chain "${intent.chain}" is not in allowedChains [${rules.allowedChains.join(", ")}]`);
  }
  if (rules.allowedWalletProviders && intent.walletProvider && !rules.allowedWalletProviders.includes(intent.walletProvider)) {
    reasons.push(`wallet provider "${intent.walletProvider}" is not in allowedWalletProviders [${rules.allowedWalletProviders.join(", ")}]`);
  }
  if (rules.allowedPaymentRails && intent.paymentRail && !rules.allowedPaymentRails.includes(intent.paymentRail)) {
    reasons.push(`payment rail "${intent.paymentRail}" is not in allowedPaymentRails [${rules.allowedPaymentRails.join(", ")}]`);
  }
  if (rules.allowedProtocols && intent.protocol && !rules.allowedProtocols.includes(intent.protocol)) {
    reasons.push(`protocol "${intent.protocol}" is not in allowedProtocols [${rules.allowedProtocols.join(", ")}]`);
  }

  return reasons.length > 0
    ? { outcome: "fail", reasons, approvalsRequired: [] }
    : { outcome: "pass", reasons: [], approvalsRequired: [] };
}
