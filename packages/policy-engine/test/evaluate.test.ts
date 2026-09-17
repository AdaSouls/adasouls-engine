import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/evaluate.js";
import type { EvaluationContext, Policy } from "../src/types.js";

const AGENT = "alma:main:agent:treasury-01";

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    agentId: AGENT,
    intent: { capability: "pay", asset: "USDC", amount: "10" },
    ...overrides,
  };
}

function selfPolicy(rules: Policy<"self">["rules"], scope: Policy["scope"] = {}, id = "pol_self"): Policy<"self"> {
  return { id, kind: "self", version: 1, scope, rules };
}

describe("exit criterion: self-policy max-transaction blocks an oversized action", () => {
  it("blocks with a correct, specific reason", () => {
    const policies = [selfPolicy({ maxTransaction: { USDC: "5" } })];
    const result = evaluatePolicy(policies, ctx({ intent: { capability: "pay", asset: "USDC", amount: "10" } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(["amount 10 USDC exceeds maxTransaction 5 USDC"]);
  });

  it("allows when within the limit", () => {
    const policies = [selfPolicy({ maxTransaction: { USDC: "50" } })];
    const result = evaluatePolicy(policies, ctx({ intent: { capability: "pay", asset: "USDC", amount: "10" } }));
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });
});

describe("unconfigured rules are not restrictive", () => {
  it("no policies at all -> allowed", () => {
    const result = evaluatePolicy([], ctx());
    expect(result.allowed).toBe(true);
    expect(result.matchedPolicies).toEqual([]);
  });

  it("a self policy with only an unrelated rule set doesn't block on maxTransaction", () => {
    const policies = [selfPolicy({ allowedActions: ["pay", "swap"] })];
    const result = evaluatePolicy(policies, ctx({ intent: { capability: "pay", asset: "USDC", amount: "999999" } }));
    expect(result.allowed).toBe(true);
  });
});

describe("self policy", () => {
  it("blocks a capability outside allowedActions", () => {
    const policies = [selfPolicy({ allowedActions: ["pay"] })];
    const result = evaluatePolicy(policies, ctx({ intent: { capability: "swap", asset: "USDC", amount: "1" } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain('capability "swap"');
  });

  it("dailySpend blocks when projected total exceeds the limit", () => {
    const policies = [selfPolicy({ dailySpend: { USDC: "100" } })];
    const result = evaluatePolicy(
      policies,
      ctx({ intent: { capability: "pay", asset: "USDC", amount: "30" }, dailySpendSoFar: { USDC: "80" } })
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("projected daily spend 110");
  });

  it("humanApprovalThreshold requires approval, not an outright deny -- allowed is still false (needs a human), reasons stays empty (it's not a hard block)", () => {
    const policies = [selfPolicy({ maxTransaction: { USDC: "1000" }, humanApprovalThreshold: { USDC: "100" } })];
    const result = evaluatePolicy(policies, ctx({ intent: { capability: "pay", asset: "USDC", amount: "500" } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual([]);
    expect(result.approvalsRequired).toEqual(["human_approval"]);
  });
});

describe("counterparty policy", () => {
  it("blocks a blocklisted counterparty even if also allowlisted (deny wins)", () => {
    const policies: Policy[] = [
      { id: "p1", kind: "counterparty", version: 1, scope: {}, rules: { allowlist: ["agent_456"], blocklist: ["agent_456"] } },
    ];
    const result = evaluatePolicy(policies, ctx({ counterparty: { id: "agent_456" } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("blocklist");
  });

  it("blocks when reputation evidence is below the minimum", () => {
    const policies: Policy[] = [
      { id: "p1", kind: "counterparty", version: 1, scope: {}, rules: { minReputationEvidence: { completedActions: 10 } } },
    ];
    const result = evaluatePolicy(
      policies,
      ctx({ counterparty: { id: "agent_456", reputationEvidence: { completedActions: 3, disputeRate: 0 } } })
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("has 3 completed actions");
  });

  it("blocks when a required credential is missing", () => {
    const policies: Policy[] = [
      { id: "p1", kind: "counterparty", version: 1, scope: {}, rules: { requiredCredentials: ["kyb_verified"] } },
    ];
    const result = evaluatePolicy(policies, ctx({ counterparty: { id: "agent_456", credentials: [] } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("kyb_verified");
  });
});

describe("market policy", () => {
  it("blocks a price exceeding maxPrice.perRequest", () => {
    const policies: Policy[] = [
      { id: "p1", kind: "market", version: 1, scope: {}, rules: { maxPrice: { perRequest: "1 USDC" } } },
    ];
    const result = evaluatePolicy(policies, ctx({ intent: { capability: "hire", price: "2 USDC" } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("exceeds maxPrice.perRequest 1 USDC");
  });

  it("blocks slippage above maxSlippage", () => {
    const policies: Policy[] = [{ id: "p1", kind: "market", version: 1, scope: {}, rules: { maxSlippage: 0.01 } }];
    const result = evaluatePolicy(policies, ctx({ intent: { capability: "swap", slippage: 0.05 } }));
    expect(result.allowed).toBe(false);
  });
});

describe("execution policy", () => {
  it("blocks a chain outside allowedChains", () => {
    const policies: Policy[] = [
      { id: "p1", kind: "execution", version: 1, scope: {}, rules: { allowedChains: ["base"] } },
    ];
    const result = evaluatePolicy(policies, ctx({ intent: { capability: "pay", chain: "ethereum" } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain('chain "ethereum"');
  });
});

describe("conflicting policies at the same scope level combine restrictively (fail-closed AND)", () => {
  it("two org-level self policies: the tighter maxTransaction wins regardless of order", () => {
    const loose = selfPolicy({ maxTransaction: { USDC: "1000" } }, {}, "pol_loose");
    const tight = selfPolicy({ maxTransaction: { USDC: "50" } }, {}, "pol_tight");

    const a = evaluatePolicy([loose, tight], ctx({ intent: { capability: "pay", asset: "USDC", amount: "100" } }));
    const b = evaluatePolicy([tight, loose], ctx({ intent: { capability: "pay", asset: "USDC", amount: "100" } }));

    expect(a.allowed).toBe(false);
    expect(b.allowed).toBe(false);
    expect(a.reasons).toEqual(b.reasons);
  });

  it("a looser policy never silently overrides a tighter one from the other order", () => {
    const loose = selfPolicy({ maxTransaction: { USDC: "1000" } }, {}, "pol_loose");
    const tight = selfPolicy({ maxTransaction: { USDC: "50" } }, {}, "pol_tight");
    // amount is within the loose limit but over the tight one -- must still fail
    const result = evaluatePolicy([loose, tight], ctx({ intent: { capability: "pay", asset: "USDC", amount: "200" } }));
    expect(result.allowed).toBe(false);
  });

  it("matchedPolicies reports both policies' own individual outcomes", () => {
    const loose = selfPolicy({ maxTransaction: { USDC: "1000" } }, {}, "pol_loose");
    const tight = selfPolicy({ maxTransaction: { USDC: "50" } }, {}, "pol_tight");
    const result = evaluatePolicy([loose, tight], ctx({ intent: { capability: "pay", asset: "USDC", amount: "100" } }));
    expect(result.matchedPolicies).toEqual(
      expect.arrayContaining([
        { policyId: "pol_loose", kind: "self", outcome: "pass" },
        { policyId: "pol_tight", kind: "self", outcome: "fail" },
      ])
    );
  });
});

describe("agent policy overrides org policy for the same rule key", () => {
  it("agent's tighter maxTransaction replaces the org default", () => {
    const orgDefault = selfPolicy({ maxTransaction: { USDC: "1000" } }, {}, "pol_org");
    const agentOverride = selfPolicy({ maxTransaction: { USDC: "20" } }, { agentId: AGENT }, "pol_agent");
    const result = evaluatePolicy([orgDefault, agentOverride], ctx({ intent: { capability: "pay", asset: "USDC", amount: "100" } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("exceeds maxTransaction 20 USDC");
  });

  it("a key the agent policy doesn't set still falls through to the org default", () => {
    const orgDefault = selfPolicy({ allowedActions: ["pay"] }, {}, "pol_org");
    const agentOverride = selfPolicy({ maxTransaction: { USDC: "20" } }, { agentId: AGENT }, "pol_agent");
    // "swap" isn't in the org's allowedActions, and the agent policy never touched that key
    const result = evaluatePolicy(
      [orgDefault, agentOverride],
      ctx({ intent: { capability: "swap", asset: "USDC", amount: "1" } })
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("allowedActions");
  });

  it("an org policy for a different agent doesn't apply", () => {
    const otherAgentPolicy = selfPolicy({ maxTransaction: { USDC: "1" } }, { agentId: "alma:main:agent:someone-else" }, "pol_other");
    const result = evaluatePolicy([otherAgentPolicy], ctx({ intent: { capability: "pay", asset: "USDC", amount: "100" } }));
    // scoped to a different agent, and not org-level (has an agentId) -- should never apply here
    expect(result.allowed).toBe(true);
  });
});

describe("evaluation order and short-circuit", () => {
  it("self -> counterparty -> market -> execution, and a self-policy deny short-circuits before counterparty is checked", () => {
    const selfDeny = selfPolicy({ allowedActions: ["swap"] }, {}, "pol_self");
    const counterpartyDeny: Policy = {
      id: "pol_cp",
      kind: "counterparty",
      version: 1,
      scope: {},
      rules: { blocklist: ["agent_456"] },
    };
    const result = evaluatePolicy(
      [selfDeny, counterpartyDeny],
      ctx({ intent: { capability: "pay" }, counterparty: { id: "agent_456" } })
    );
    expect(result.allowed).toBe(false);
    // only the self-policy reason should appear -- counterparty was never reached
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("capability")]));
    expect(result.matchedPolicies.some((m) => m.kind === "counterparty")).toBe(false);
  });

  it("requires_approval does NOT short-circuit -- later kinds still get evaluated", () => {
    const selfApproval = selfPolicy(
      { maxTransaction: { USDC: "1000" }, humanApprovalThreshold: { USDC: "10" } },
      {},
      "pol_self"
    );
    const executionDeny: Policy = {
      id: "pol_exec",
      kind: "execution",
      version: 1,
      scope: {},
      rules: { allowedChains: ["base"] },
    };
    const result = evaluatePolicy(
      [selfApproval, executionDeny],
      ctx({ intent: { capability: "pay", asset: "USDC", amount: "500", chain: "ethereum" } })
    );
    expect(result.approvalsRequired).toEqual(["human_approval"]);
    // execution was still reached and denied, proving self's requires_approval didn't stop evaluation
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain('chain "ethereum"');
  });
});
