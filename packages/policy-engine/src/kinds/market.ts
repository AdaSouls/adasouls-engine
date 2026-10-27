import { compareAmounts, isAmount } from "../amounts.js";
import type { EvaluationContext, MarketPolicyRules } from "../types.js";
import { mergeIntersect, mergeLowerBoundNumber, mergeUpperBound, mergeUpperBoundNumber } from "../merge.js";
import type { KindResult } from "./self.js";

export function combineMarketRulesRestrictive(a: MarketPolicyRules, b: MarketPolicyRules): MarketPolicyRules {
  return {
    maxPrice: { perRequest: mergePriceCaps(a.maxPrice?.perRequest, b.maxPrice?.perRequest) },
    allowedCurrencies: mergeIntersect(a.allowedCurrencies, b.allowedCurrencies),
    minSLA: { successRate: mergeLowerBoundNumber(a.minSLA?.successRate, b.minSLA?.successRate) },
    maxSlippage: mergeUpperBoundNumber(a.maxSlippage, b.maxSlippage),
  };
}

function parseAmountAsset(s: string | undefined): { amount: string; asset: string } | undefined {
  const match = typeof s === "string" ? /^(\S+) (\S+)$/.exec(s) : null;
  if (!match || !isAmount(match[1])) return undefined;
  return { amount: match[1], asset: match[2] };
}

/**
 * One cap per asset, the lower of the two where both set one. A cap that
 * can't be read is kept as written, so evaluation denies on it instead of
 * the other side's cap silently standing in for it.
 */
function mergePriceCaps(a: string | string[] | undefined, b: string | string[] | undefined): string | string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const unreadable: string[] = [];
  const perAsset = new Map<string, string>();
  for (const cap of [a, b].flat()) {
    const parsed = parseAmountAsset(cap);
    if (!parsed) {
      unreadable.push(cap);
      continue;
    }
    perAsset.set(parsed.asset, mergeUpperBound(perAsset.get(parsed.asset), parsed.amount)!);
  }
  return [...unreadable, ...[...perAsset].map(([asset, amount]) => `${amount} ${asset}`)];
}

export function evaluateMarketRules(rules: MarketPolicyRules, ctx: EvaluationContext): KindResult {
  const reasons: string[] = [];
  const { intent } = ctx;

  if (rules.allowedCurrencies) {
    if (!intent.asset) reasons.push("asset required: allowedCurrencies is set and the intent has no asset");
    else if (!rules.allowedCurrencies.includes(intent.asset)) {
      reasons.push(`asset "${intent.asset}" is not in allowedCurrencies [${rules.allowedCurrencies.join(", ")}]`);
    }
  }

  if (rules.maxPrice?.perRequest !== undefined) {
    // A cap or a price that can't be read denies, and so does a price in
    // an asset no cap covers: prices are never converted between assets.
    const caps = [rules.maxPrice.perRequest].flat();
    const unreadable = caps.filter((c) => !parseAmountAsset(c));
    const price = parseAmountAsset(intent.price);
    if (unreadable.length > 0) {
      reasons.push(...unreadable.map((c) => `maxPrice.perRequest "${c}" is not "<decimal amount> <asset>"`));
    } else if (intent.price === undefined) {
      reasons.push("price required: maxPrice.perRequest is set and the intent has no price");
    } else if (!price) {
      reasons.push(`price "${intent.price}" is not "<decimal amount> <asset>"`);
    } else {
      const cap = caps.map(parseAmountAsset).find((c) => c!.asset === price.asset);
      if (!cap) {
        reasons.push(`price is in ${price.asset}, and maxPrice.perRequest caps only ${caps.join(", ")}`);
      } else if (compareAmounts(price.amount, cap.amount) === 1) {
        reasons.push(`price ${intent.price} exceeds maxPrice.perRequest ${cap.amount} ${cap.asset}`);
      }
    }
  }

  if (rules.maxSlippage !== undefined) {
    if (intent.slippage === undefined) reasons.push("slippage required: maxSlippage is set and the intent has no slippage");
    else if (!(intent.slippage <= rules.maxSlippage)) reasons.push(`slippage ${intent.slippage} exceeds maxSlippage ${rules.maxSlippage}`);
  }

  if (rules.minSLA?.successRate !== undefined) {
    const actual = ctx.counterparty?.successRate;
    if (actual === undefined) {
      reasons.push(`not enough evidence: minSLA requires a success rate of ${rules.minSLA.successRate} and the counterparty has no successRate`);
    } else if (!(actual >= rules.minSLA.successRate)) {
      reasons.push(`counterparty success rate ${actual} is below minSLA ${rules.minSLA.successRate}`);
    }
  }

  return reasons.length > 0
    ? { outcome: "fail", reasons, approvalsRequired: [] }
    : { outcome: "pass", reasons: [], approvalsRequired: [] };
}
