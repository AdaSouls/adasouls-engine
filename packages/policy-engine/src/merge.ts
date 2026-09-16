/**
 * "Most restrictive wins" combinators, used only to combine multiple
 * policies of the SAME kind at the SAME scope level (e.g. two org-level
 * self policies) -- this is what "fail-closed AND semantics: any policy
 * denying denies the whole evaluation" (11-policy-model.md) requires: a
 * naive last-write-wins merge could silently drop a tighter limit set by
 * an earlier policy, which would be a fail-OPEN bug in an authorization
 * system. Cross-scope-level combination (agent overrides org) is a
 * separate, simpler shallow-replace -- see evaluate.ts.
 *
 * One deliberate simplification, flagged rather than silently made:
 * "any-of" list rules (allowlist, communityMembership) are combined via
 * intersection here. That's a safe (stricter) approximation, not a
 * mathematically exact decomposition of "(A or B) and (C or D)" into a
 * single list -- an exact model would need to keep both checks
 * independent rather than pre-merging. Revisit if this ever causes a
 * real false-deny in practice.
 */

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** More restrictive of two optional upper-bound amounts (lower wins) -- maxTransaction, dailySpend, humanApprovalThreshold. */
export function mergeUpperBound(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return (num(a) ?? Infinity) <= (num(b) ?? Infinity) ? a : b;
}

/** More restrictive of two optional lower-bound amounts (higher wins) -- minTokenHoldings. */
export function mergeLowerBoundAmount(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return (num(a) ?? -Infinity) >= (num(b) ?? -Infinity) ? a : b;
}

/** More restrictive of two optional numeric lower bounds (higher wins) -- minCompletedTransactions, minReputationEvidence.completedActions. */
export function mergeLowerBoundNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** More restrictive of two optional numeric upper bounds (lower wins) -- disputeRate ceiling, maxSlippage. */
export function mergeUpperBoundNumber(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

export function mergeAmountMap(
  a: Record<string, string> | undefined,
  b: Record<string, string> | undefined,
  combine: (x: string | undefined, y: string | undefined) => string | undefined
): Record<string, string> | undefined {
  if (!a && !b) return undefined;
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const merged = combine(a?.[k], b?.[k]);
    if (merged !== undefined) out[k] = merged;
  }
  return out;
}

/** More restrictive "must be in this set" list -- allowedAssets, allowedProtocols, allowedContracts, allowedActions, allowlist, communityMembership, allowedChains, allowedWalletProviders, allowedPaymentRails, allowedCurrencies. */
export function mergeIntersect(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.filter((x) => b.includes(x));
}

/** More restrictive "requires all of these" / "deny any of these" list -- requiredCredentials, blocklist. */
export function mergeUnion(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (!a) return b;
  if (!b) return a;
  return Array.from(new Set([...a, ...b]));
}

/** Shallow override: b's defined keys replace a's for the same key; undefined keys in b don't erase a's value. Used for agent-overrides-org (cross-scope-level). */
export function overrideDefined<T extends object>(a: T, b: Partial<T>): T {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
