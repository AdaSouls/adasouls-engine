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

describe("an organization's rules are a ceiling: an agent's own policy can tighten them, never loosen them", () => {
  it("an agent's tighter maxTransaction applies", () => {
    const orgDefault = selfPolicy({ maxTransaction: { USDC: "1000" } }, {}, "pol_org");
    const agentOwn = selfPolicy({ maxTransaction: { USDC: "20" } }, { agentId: AGENT }, "pol_agent");
    const result = evaluatePolicy([orgDefault, agentOwn], ctx({ intent: { capability: "pay", asset: "USDC", amount: "100" } }));
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain("exceeds maxTransaction 20 USDC");
  });

  it("an agent's looser maxTransaction changes nothing: the organization's limit still applies", () => {
    const org = selfPolicy({ maxTransaction: { USDC: "20" } }, {}, "pol_org");
    const agentOwn = selfPolicy({ maxTransaction: { USDC: "1000000" } }, { agentId: AGENT }, "pol_agent");
    for (const policies of [[org, agentOwn], [agentOwn, org]]) {
      const result = evaluatePolicy(policies, ctx({ intent: { capability: "pay", asset: "USDC", amount: "100" } }));
      expect(result.allowed).toBe(false);
      expect(result.reasons[0]).toContain("exceeds maxTransaction 20 USDC");
    }
  });

  it("an agent can't widen the organization's lists, raise its approval threshold or its daily limit", () => {
    const org = selfPolicy({ allowedAssets: ["USDC"], allowedActions: ["pay"], dailySpend: { USDC: "50" }, humanApprovalThreshold: { USDC: "10" } }, {}, "pol_org");
    const agentOwn = selfPolicy({ allowedAssets: ["USDC", "DAI"], allowedActions: ["pay", "swap"], dailySpend: { USDC: "5000" }, humanApprovalThreshold: { USDC: "4000" } }, { agentId: AGENT }, "pol_agent");
    const evaluate = (intent: EvaluationContext["intent"], dailySpendSoFar?: Record<string, string>) => evaluatePolicy([org, agentOwn], ctx({ intent, dailySpendSoFar }));

    expect(evaluate({ capability: "pay", asset: "DAI", amount: "1" }).reasons[0]).toContain("allowedAssets");
    expect(evaluate({ capability: "swap", asset: "USDC", amount: "1" }).reasons[0]).toContain("allowedActions");
    expect(evaluate({ capability: "pay", asset: "USDC", amount: "5" }, { USDC: "48" }).reasons[0]).toContain("dailySpend limit 50 USDC");
    expect(evaluate({ capability: "pay", asset: "USDC", amount: "11" }).approvalsRequired).toEqual(["human_approval"]);
    expect(evaluate({ capability: "pay", asset: "USDC", amount: "9" }).allowed).toBe(true);
  });

  it("the same holds for counterparty rules: an agent's own allowlist can't add to the organization's", () => {
    const org: Policy<"counterparty"> = { id: "pol_org_cp", kind: "counterparty", version: 1, scope: {}, rules: { allowlist: ["alma:main:agent:supplier"] } };
    const agentOwn: Policy<"counterparty"> = { id: "pol_agent_cp", kind: "counterparty", version: 1, scope: { agentId: AGENT }, rules: { allowlist: ["alma:main:agent:supplier", "alma:main:agent:stranger"] } };
    expect(evaluatePolicy([org, agentOwn], ctx({ counterparty: { id: "alma:main:agent:stranger" } })).allowed).toBe(false);
    expect(evaluatePolicy([org, agentOwn], ctx({ counterparty: { id: "alma:main:agent:supplier" } })).allowed).toBe(true);
  });

  it("a key the agent policy doesn't set still falls through to the org default", () => {
    const orgDefault = selfPolicy({ allowedActions: ["pay"] }, {}, "pol_org");
    const agentOwn = selfPolicy({ maxTransaction: { USDC: "20" } }, { agentId: AGENT }, "pol_agent");
    // "swap" isn't in the org's allowedActions, and the agent policy never touched that key
    const result = evaluatePolicy(
      [orgDefault, agentOwn],
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
    // execution was still reached and denied, proving self's requires_approval didn't stop evaluation
    expect(result.allowed).toBe(false);
    expect(result.reasons[0]).toContain('chain "ethereum"');
    // ...and the deny discards the approval: callers map a non-empty approvalsRequired to
    // pending_approval, which would let a human approve an action a policy denied.
    expect(result.approvalsRequired).toEqual([]);
  });

  it("a hard deny is never approvable: self needs approval, counterparty denies -> no approvals left", () => {
    const selfApproval = selfPolicy({ humanApprovalThreshold: { USDC: "50" } }, {}, "pol_self");
    const counterpartyDeny: Policy = {
      id: "pol_cp",
      kind: "counterparty",
      version: 1,
      scope: {},
      rules: { minCompletedTransactions: 2 },
    };
    const result = evaluatePolicy(
      [selfApproval, counterpartyDeny],
      ctx({ intent: { capability: "pay", asset: "USDC", amount: "750" }, counterparty: { id: "agent_456", completedTransactions: 0 } })
    );
    expect(result.allowed).toBe(false);
    expect(result.approvalsRequired).toEqual([]);
    expect(result.reasons.join(" ")).toMatch(/completed transactions/);
  });

  it("approval alone (nothing denied) still asks for approval", () => {
    const result = evaluatePolicy(
      [selfPolicy({ humanApprovalThreshold: { USDC: "50" } }, {}, "pol_self")],
      ctx({ intent: { capability: "pay", asset: "USDC", amount: "750" } })
    );
    expect(result).toMatchObject({ allowed: false, approvalsRequired: ["human_approval"], reasons: [] });
  });
});

describe("amounts are compared exactly, and anything that isn't an amount denies", () => {
  const pay = (amount: string, rules: Policy<"self">["rules"], dailySpendSoFar?: Record<string, string>) =>
    evaluatePolicy([selfPolicy(rules)], ctx({ intent: { capability: "pay", asset: "USDC", amount }, dailySpendSoFar }));

  it("decimal fractions add up to what they say", () => {
    // As floating point, 0.1 + 0.2 is 0.30000000000000004 and would be refused.
    expect(pay("0.2", { dailySpend: { USDC: "0.3" } }, { USDC: "0.1" }).allowed).toBe(true);
    expect(pay("0.2", { dailySpend: { USDC: "0.3" } }, { USDC: "0.11" }).reasons).toEqual(["projected daily spend 0.31 USDC exceeds dailySpend limit 0.3 USDC"]);
  });

  it("a difference past the sixteenth digit still counts", () => {
    // As floating point these two are the same number, and the payment would pass.
    expect(pay("9007199254740993", { maxTransaction: { USDC: "9007199254740992" } }).allowed).toBe(false);
    expect(pay("1.000000000000000001", { maxTransaction: { USDC: "1" } }).allowed).toBe(false);
    expect(pay("1.000", { maxTransaction: { USDC: "1" } }).allowed).toBe(true);
  });

  it("an amount that isn't a plain decimal is refused, not read as zero", () => {
    for (const amount of ["", " ", "-5", "1e3", "0x10", "Infinity", "1,000", "abc"]) {
      const result = pay(amount, { maxTransaction: { USDC: "100" } });
      expect(result.allowed, amount).toBe(false);
      expect(result.reasons[0]).toContain("is not a decimal amount");
    }
  });

  it("a negative amount can't be used to lower what was spent today", () => {
    expect(pay("-40", { dailySpend: { USDC: "50" } }, { USDC: "45" }).allowed).toBe(false);
  });

  it("a limit that can't be read denies, and is never dropped in favour of a looser one", () => {
    expect(pay("1", { maxTransaction: { USDC: "one hundred" } }).reasons[0]).toContain("maxTransaction for USDC");
    expect(pay("1", { dailySpend: { USDC: "" } }).allowed).toBe(false);
    const org = selfPolicy({ maxTransaction: { USDC: "ten" } }, {}, "pol_org");
    const agentOwn = selfPolicy({ maxTransaction: { USDC: "1000" } }, { agentId: AGENT }, "pol_agent");
    expect(evaluatePolicy([org, agentOwn], ctx({ intent: { capability: "pay", asset: "USDC", amount: "1" } })).allowed).toBe(false);
    expect(pay("1", { dailySpend: { USDC: "50" } }, { USDC: "lots" }).allowed).toBe(false);
  });

  it("a price ceiling that can't be read denies", () => {
    const market: Policy<"market"> = { id: "pol_market", kind: "market", version: 1, scope: {}, rules: { maxPrice: { perRequest: "cheap USDC" } } };
    expect(evaluatePolicy([market], ctx({ intent: { capability: "pay", asset: "USDC", amount: "1", price: "1 USDC" } })).allowed).toBe(false);
    const priced: Policy<"market"> = { ...market, rules: { maxPrice: { perRequest: "0.3 USDC" } } };
    expect(evaluatePolicy([priced], ctx({ intent: { capability: "pay", asset: "USDC", amount: "1", price: "0.30 USDC" } })).allowed).toBe(true);
    expect(evaluatePolicy([priced], ctx({ intent: { capability: "pay", asset: "USDC", amount: "1", price: "0.31 USDC" } })).allowed).toBe(false);
  });
});
