import { compareAmounts, isAmount } from "../amounts.js";
import type { EvaluationContext, MarketPolicyRules } from "../types.js";
import { mergeIntersect, mergeUpperBound, mergeUpperBoundNumber } from "../merge.js";
import type { KindResult } from "./self.js";

export function combineMarketRulesRestrictive(a: MarketPolicyRules, b: MarketPolicyRules): MarketPolicyRules {
  return {
    maxPrice: { perRequest: mergeUpperBound(a.maxPrice?.perRequest, b.maxPrice?.perRequest) },
    allowedCurrencies: mergeIntersect(a.allowedCurrencies, b.allowedCurrencies),
    minSLA: { successRate: Math.max(a.minSLA?.successRate ?? 0, b.minSLA?.successRate ?? 0) || undefined },
    maxSlippage: mergeUpperBoundNumber(a.maxSlippage, b.maxSlippage),
  };
}

function parseAmountAsset(s: string | undefined): { amount: string; asset: string } | undefined {
  if (!s) return undefined;
  const [amount, asset] = s.split(" ");
  if (!asset || !isAmount(amount)) return undefined;
  return { amount, asset };
}

export function evaluateMarketRules(rules: MarketPolicyRules, ctx: EvaluationContext): KindResult {
  const reasons: string[] = [];
  const { intent } = ctx;

  if (rules.allowedCurrencies && intent.asset && !rules.allowedCurrencies.includes(intent.asset)) {
    reasons.push(`asset "${intent.asset}" is not in allowedCurrencies [${rules.allowedCurrencies.join(", ")}]`);
  }

  const max = parseAmountAsset(rules.maxPrice?.perRequest);
  const price = parseAmountAsset(intent.price);
  // A price ceiling or a price that can't be read denies, rather than the check being skipped.
  if (rules.maxPrice?.perRequest !== undefined && !max) {
    reasons.push(`maxPrice.perRequest "${rules.maxPrice.perRequest}" is not "<decimal amount> <asset>"`);
  } else if (max && intent.price !== undefined && !price) {
    reasons.push(`price "${intent.price}" is not "<decimal amount> <asset>"`);
  } else if (max && price && max.asset === price.asset && compareAmounts(price.amount, max.amount) === 1) {
    reasons.push(`price ${intent.price} exceeds maxPrice.perRequest ${rules.maxPrice?.perRequest}`);
  }

  if (rules.maxSlippage !== undefined && intent.slippage !== undefined && intent.slippage > rules.maxSlippage) {
    reasons.push(`slippage ${intent.slippage} exceeds maxSlippage ${rules.maxSlippage}`);
  }

  if (rules.minSLA?.successRate !== undefined) {
    const actual = ctx.counterparty?.successRate;
    if (actual !== undefined && actual < rules.minSLA.successRate) {
      reasons.push(`counterparty success rate ${actual} is below minSLA ${rules.minSLA.successRate}`);
    }
  }

  return reasons.length > 0
    ? { outcome: "fail", reasons, approvalsRequired: [] }
    : { outcome: "pass", reasons: [], approvalsRequired: [] };
}
