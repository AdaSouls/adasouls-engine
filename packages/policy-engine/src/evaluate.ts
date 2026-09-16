import type {
  EvaluationContext,
  MatchedPolicy,
  Policy,
  PolicyEvaluation,
  PolicyKind,
  RulesFor,
} from "./types.js";
import { POLICY_EVALUATION_ORDER } from "./types.js";
import { overrideDefined } from "./merge.js";
import { combineSelfRulesRestrictive, evaluateSelfRules, type KindResult } from "./kinds/self.js";
import { combineCounterpartyRulesRestrictive, evaluateCounterpartyRules } from "./kinds/counterparty.js";
import { combineMarketRulesRestrictive, evaluateMarketRules } from "./kinds/market.js";
import { combineExecutionRulesRestrictive, evaluateExecutionRules } from "./kinds/execution.js";

export type { KindResult };

const KIND_HANDLERS: {
  [K in PolicyKind]: {
    combineRestrictive: (a: RulesFor<K>, b: RulesFor<K>) => RulesFor<K>;
    evaluateRules: (rules: RulesFor<K>, ctx: EvaluationContext) => KindResult;
  };
} = {
  self: { combineRestrictive: combineSelfRulesRestrictive, evaluateRules: evaluateSelfRules },
  counterparty: { combineRestrictive: combineCounterpartyRulesRestrictive, evaluateRules: evaluateCounterpartyRules },
  market: { combineRestrictive: combineMarketRulesRestrictive, evaluateRules: evaluateMarketRules },
  execution: { combineRestrictive: combineExecutionRulesRestrictive, evaluateRules: evaluateExecutionRules },
};

function isAgentScoped(policy: Policy, agentId: string): boolean {
  return policy.scope.agentId === agentId;
}

function isOrgScoped(policy: Policy): boolean {
  return policy.scope.agentId === undefined;
}

/**
 * Resolves the effective rule set for one kind from every applicable
 * policy of that kind:
 * - Multiple policies at the SAME scope level (e.g. two org policies)
 *   combine restrictively (most-restrictive-wins per field) -- this is
 *   "fail-closed AND semantics," implemented at the rule-value level so
 *   a tighter earlier policy can never be silently dropped by a later
 *   one (see merge.ts).
 * - Agent-scoped policies then override org-scoped policies per rule
 *   KEY (simple replace, not restrictive-combine) -- "agent policy
 *   overrides org default policy for the same rule key," per
 *   11-policy-model.md, literally: a key an agent policy doesn't set
 *   still falls through to the org default.
 */
function resolveEffectiveRules<K extends PolicyKind>(
  kind: K,
  policiesOfKind: Policy<K>[],
  agentId: string
): RulesFor<K> {
  const handler = KIND_HANDLERS[kind];
  const orgRules = policiesOfKind.filter(isOrgScoped).map((p) => p.rules);
  const agentRules = policiesOfKind.filter((p) => isAgentScoped(p, agentId)).map((p) => p.rules);

  const orgMerged = orgRules.reduce<RulesFor<K> | undefined>(
    (acc, r) => (acc ? handler.combineRestrictive(acc, r) : r),
    undefined
  ) ?? ({} as RulesFor<K>);
  const agentMerged = agentRules.reduce<RulesFor<K> | undefined>(
    (acc, r) => (acc ? handler.combineRestrictive(acc, r) : r),
    undefined
  );

  return agentMerged ? overrideDefined(orgMerged, agentMerged) : orgMerged;
}

/**
 * The only entry point. Evaluates self -> counterparty -> market ->
 * execution in that fixed order (11-policy-model.md). Short-circuits on
 * the first hard "fail" (remaining kinds aren't evaluated -- there's no
 * reason to, the action is already denied), but a "requires_approval"
 * outcome does NOT short-circuit -- evaluation continues so the caller
 * sees every approval needed, not just the first one.
 */
export function evaluatePolicy(policies: Policy[], context: EvaluationContext): PolicyEvaluation {
  const reasons: string[] = [];
  const approvalsRequired: string[] = [];
  const matchedPolicies: MatchedPolicy[] = [];
  let allowed = true;

  for (const kind of POLICY_EVALUATION_ORDER) {
    const policiesOfKind = policies.filter((p) => p.kind === kind) as Policy<typeof kind>[];
    const handler = KIND_HANDLERS[kind];

    // Individual per-policy outcomes, for the audit-facing matchedPolicies
    // list -- evaluated against each policy's own (unmerged) rules, since
    // that's what "which policyId contributed what" means.
    for (const policy of policiesOfKind) {
      const individual = handler.evaluateRules(policy.rules, context);
      matchedPolicies.push({ policyId: policy.id, kind, outcome: individual.outcome });
    }

    if (policiesOfKind.length === 0) continue;

    const effectiveRules = resolveEffectiveRules(kind, policiesOfKind, context.agentId);
    const result = handler.evaluateRules(effectiveRules, context);

    if (result.outcome === "fail") {
      allowed = false;
      reasons.push(...result.reasons);
      break; // short-circuit: no reason to evaluate later kinds
    }
    if (result.outcome === "requires_approval") {
      approvalsRequired.push(...result.approvalsRequired);
    }
  }

  return { allowed, reasons, approvalsRequired, matchedPolicies };
}
