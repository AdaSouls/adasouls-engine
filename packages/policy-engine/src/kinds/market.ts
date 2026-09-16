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

function parseAmountAsset(s: string | undefined): { amount: number; asset: string } | undefined {
  if (!s) return undefined;
  const [amount, asset] = s.split(" ");
  const n = Number(amount);
  if (!asset || !Number.isFinite(n)) return undefined;
  return { amount: n, asset };
}

export function evaluateMarketRules(rules: MarketPolicyRules, ctx: EvaluationContext): KindResult {
  const reasons: string[] = [];
  const { intent } = ctx;

  if (rules.allowedCurrencies && intent.asset && !rules.allowedCurrencies.includes(intent.asset)) {
    reasons.push(`asset "${intent.asset}" is not in allowedCurrencies [${rules.allowedCurrencies.join(", ")}]`);
  }

  const max = parseAmountAsset(rules.maxPrice?.perRequest);
  const price = parseAmountAsset(intent.price);
  if (max && price && max.asset === price.asset && price.amount > max.amount) {
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
