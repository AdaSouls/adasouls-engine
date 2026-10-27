import { describe, expect, it, vi } from "vitest";
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

const AT = (iso: string) => new Date(iso);

describe("B1: allow-lists with nothing in common allow nothing", () => {
  const cp = (rules: Policy<"counterparty">["rules"], scope: Policy["scope"] = {}, id = "pol_cp"): Policy<"counterparty"> => ({ id, kind: "counterparty", version: 1, scope, rules });
  const allowed = (policies: Policy[], id: string) => evaluatePolicy(policies, ctx({ counterparty: { id, communities: [id] } })).allowed;

  it('["A"] + ["B"] denies A, B and C', () => {
    const policies = [cp({ allowlist: ["A"] }, {}, "org"), cp({ allowlist: ["B"] }, { agentId: AGENT }, "agent")];
    for (const id of ["A", "B", "C"]) expect(allowed(policies, id), id).toBe(false);
  });

  it('["A", "B"] + ["B"] allows only B', () => {
    const policies = [cp({ allowlist: ["A", "B"] }, {}, "org"), cp({ allowlist: ["B"] }, { agentId: AGENT }, "agent")];
    expect(allowed(policies, "A")).toBe(false);
    expect(allowed(policies, "B")).toBe(true);
    expect(allowed(policies, "C")).toBe(false);
  });

  it('no org list + ["B"] allows only B', () => {
    const policies = [cp({ minCompletedTransactions: 0 }, {}, "org"), cp({ allowlist: ["B"] }, { agentId: AGENT }, "agent")];
    expect(allowed(policies, "A")).toBe(false);
    expect(allowed(policies, "B")).toBe(true);
    expect(allowed(policies, "C")).toBe(false);
  });

  it("the same for communityMembership", () => {
    const disjoint = [cp({ communityMembership: ["A"] }, {}, "org"), cp({ communityMembership: ["B"] }, { agentId: AGENT }, "agent")];
    for (const id of ["A", "B", "C"]) expect(allowed(disjoint, id), id).toBe(false);
    const overlapping = [cp({ communityMembership: ["A", "B"] }, {}, "org"), cp({ communityMembership: ["B"] }, { agentId: AGENT }, "agent")];
    expect(allowed(overlapping, "A")).toBe(false);
    expect(allowed(overlapping, "B")).toBe(true);
    const agentOnly = [cp({ communityMembership: ["B"] }, { agentId: AGENT }, "agent")];
    expect(allowed(agentOnly, "A")).toBe(false);
    expect(allowed(agentOnly, "B")).toBe(true);
  });

  it("an empty list written in a policy allows nothing either", () => {
    expect(allowed([cp({ allowlist: [] })], "A")).toBe(false);
    expect(evaluatePolicy([selfPolicy({ allowedAssets: [] })], ctx()).allowed).toBe(false);
  });

  it("disjoint self and execution lists deny too", () => {
    const self = [selfPolicy({ allowedAssets: ["USDC"] }, {}, "org"), selfPolicy({ allowedAssets: ["DAI"] }, { agentId: AGENT }, "agent")];
    expect(evaluatePolicy(self, ctx({ intent: { capability: "pay", asset: "USDC", amount: "1" } })).allowed).toBe(false);
    const exec: Policy[] = [
      { id: "org", kind: "execution", version: 1, scope: {}, rules: { allowedChains: ["base"] } },
      { id: "agent", kind: "execution", version: 1, scope: { agentId: AGENT }, rules: { allowedChains: ["ethereum"] } },
    ];
    expect(evaluatePolicy(exec, ctx({ intent: { capability: "pay", chain: "base" } })).allowed).toBe(false);
  });
});

describe("B2: time windows intersect, end hour excluded, in the policy's timezone", () => {
  const at = (iso: string, ...windows: Policy<"self">["rules"]["timeRestrictions"][]) => {
    const policies = windows.map((w, i) => selfPolicy({ timeRestrictions: w }, i === 0 ? {} : { agentId: AGENT }, `pol_${i}`));
    return evaluatePolicy(policies, ctx({ now: AT(iso) }));
  };
  const work = { allowedHours: [9, 17] as [number, number] };

  it("03:00 against org [9,17] + agent [0,5] is denied: an agent can't widen the org's window", () => {
    const result = at("2026-10-27T03:00:00Z", work, { allowedHours: [0, 5] });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(["hour 3 UTC is outside allowedHours [9, 17)"]);
  });

  it("an agent's narrower window applies inside the org's", () => {
    const narrower = { allowedHours: [10, 12] as [number, number] };
    expect(at("2026-10-27T11:00:00Z", work, narrower).allowed).toBe(true);
    expect(at("2026-10-27T09:00:00Z", work, narrower).allowed).toBe(false);
    expect(at("2026-10-27T13:00:00Z", work, narrower).allowed).toBe(false);
  });

  it("windows that don't overlap deny every hour", () => {
    for (let h = 0; h < 24; h++) {
      const iso = `2026-10-27T${String(h).padStart(2, "0")}:30:00Z`;
      expect(at(iso, { allowedHours: [9, 12] }, { allowedHours: [12, 17] }).allowed, iso).toBe(false);
    }
  });

  it("the end hour is excluded", () => {
    expect(at("2026-10-27T09:00:00Z", work).allowed).toBe(true);
    expect(at("2026-10-27T16:59:59Z", work).allowed).toBe(true);
    expect(at("2026-10-27T17:00:00Z", work).allowed).toBe(false);
    expect(at("2026-10-27T08:59:59Z", work).allowed).toBe(false);
  });

  it("[0, 24] is the whole day and [h, h] is no hour", () => {
    expect(at("2026-10-27T23:30:00Z", { allowedHours: [0, 24] }).allowed).toBe(true);
    expect(at("2026-10-27T00:00:00Z", { allowedHours: [0, 24] }).allowed).toBe(true);
    expect(at("2026-10-27T09:30:00Z", { allowedHours: [9, 9] }).allowed).toBe(false);
  });

  it("an overnight window [22, 6] wraps past midnight", () => {
    const night = { allowedHours: [22, 6] as [number, number] };
    for (const h of ["22", "23", "00", "05"]) expect(at(`2026-10-27T${h}:15:00Z`, night).allowed, h).toBe(true);
    for (const h of ["06", "12", "21"]) expect(at(`2026-10-27T${h}:15:00Z`, night).allowed, h).toBe(false);
  });

  it("an overnight window intersected with a daytime one leaves only the overlap", () => {
    const night = { allowedHours: [22, 6] as [number, number] };
    const late = { allowedHours: [4, 23] as [number, number] };
    for (const h of ["04", "05", "22"]) expect(at(`2026-10-27T${h}:15:00Z`, night, late).allowed, h).toBe(true);
    for (const h of ["03", "06", "23"]) expect(at(`2026-10-27T${h}:15:00Z`, night, late).allowed, h).toBe(false);
  });

  it("the window is read in the policy's timezone", () => {
    const ny = { timezone: "America/New_York", allowedHours: [9, 17] as [number, number] };
    // 2026-10-27 is EDT (UTC-4): 13:00Z is 09:00 there, 21:00Z is 17:00.
    expect(at("2026-10-27T13:00:00Z", ny).allowed).toBe(true);
    expect(at("2026-10-27T12:59:00Z", ny).allowed).toBe(false);
    expect(at("2026-10-27T21:00:00Z", ny).reasons).toEqual(["hour 17 America/New_York is outside allowedHours [9, 17)"]);
    // After the clocks change (2026-11-01) 13:00Z is 08:00 EST.
    expect(at("2026-11-03T13:00:00Z", ny).allowed).toBe(false);
  });

  it("windows in different timezones each apply in their own", () => {
    const utc = { allowedHours: [12, 24] as [number, number] };
    const tokyo = { timezone: "Asia/Tokyo", allowedHours: [0, 9] as [number, number] }; // 15:00Z-00:00Z
    expect(at("2026-10-27T16:00:00Z", utc, tokyo).allowed).toBe(true);
    expect(at("2026-10-27T13:00:00Z", utc, tokyo).allowed).toBe(false);
  });

  it("UTC is the default timezone", () => {
    expect(at("2026-10-27T10:00:00Z", { allowedHours: [9, 11] }).allowed).toBe(true);
    expect(at("2026-10-27T10:00:00Z", { timezone: "UTC", allowedHours: [9, 11] }).allowed).toBe(true);
  });

  it("an unknown timezone or unreadable hours deny", () => {
    expect(at("2026-10-27T10:00:00Z", { timezone: "Mars/Olympus", allowedHours: [0, 24] }).reasons[0]).toContain('"Mars/Olympus" is not a known timezone');
    for (const hours of [[-1, 5], [9, 25], [24, 6], [9.5, 17]] as [number, number][]) {
      expect(at("2026-10-27T10:00:00Z", { allowedHours: hours }).allowed, JSON.stringify(hours)).toBe(false);
    }
  });

  it("with no ctx.now the current time is used, not the rule skipped", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(AT("2026-10-27T03:00:00Z"));
      expect(evaluatePolicy([selfPolicy({ timeRestrictions: work })], ctx()).allowed).toBe(false);
      vi.setSystemTime(AT("2026-10-27T10:00:00Z"));
      expect(evaluatePolicy([selfPolicy({ timeRestrictions: work })], ctx()).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("B4: maxPrice caps merge per asset, and a price in an uncapped asset is denied", () => {
  const market = (perRequest: string | string[], scope: Policy["scope"] = {}, id = "pol_market"): Policy<"market"> => ({ id, kind: "market", version: 1, scope, rules: { maxPrice: { perRequest } } });
  const priced = (policies: Policy[], price: string) => evaluatePolicy(policies, ctx({ intent: { capability: "hire", price } }));

  it("the lower cap wins, whichever order the policies come in", () => {
    const org = market("1 USDC", {}, "org");
    const agent = market("5 USDC", { agentId: AGENT }, "agent");
    for (const policies of [[org, agent], [agent, org]]) {
      expect(priced(policies, "2 USDC").allowed).toBe(false);
      expect(priced(policies, "1 USDC").allowed).toBe(true);
    }
    const twoOrgs = [market("5 USDC", {}, "a"), market("1 USDC", {}, "b")];
    expect(priced(twoOrgs, "2 USDC").reasons).toEqual(["price 2 USDC exceeds maxPrice.perRequest 1 USDC"]);
  });

  it("a price in another asset doesn't escape the cap", () => {
    expect(priced([market("1 USDC")], "1000 DAI").reasons).toEqual(["price is in DAI, and maxPrice.perRequest caps only 1 USDC"]);
    expect(priced([market("1 USDC", {}, "org"), market("2 DAI", { agentId: AGENT }, "agent")], "1000 EUR").allowed).toBe(false);
  });

  it("caps in different assets are each kept", () => {
    const policies = [market("1 USDC", {}, "org"), market(["2 DAI", "3 USDC"], { agentId: AGENT }, "agent")];
    expect(priced(policies, "1 USDC").allowed).toBe(true);
    expect(priced(policies, "1.5 USDC").allowed).toBe(false);
    expect(priced(policies, "2 DAI").allowed).toBe(true);
    expect(priced(policies, "2.01 DAI").allowed).toBe(false);
  });

  it("prices compare as decimals", () => {
    expect(priced([market("0.3 USDC")], "0.300000000000000001 USDC").allowed).toBe(false);
    expect(priced([market("9007199254740992 USDC")], "9007199254740993 USDC").allowed).toBe(false);
    expect(priced([market("0.3 USDC")], "0.30 USDC").allowed).toBe(true);
  });

  it("an unreadable cap is kept through a merge and denies", () => {
    expect(priced([market("cheap USDC", {}, "org"), market("5 USDC", { agentId: AGENT }, "agent")], "1 USDC").allowed).toBe(false);
    expect(priced([market("1  USDC")], "1 USDC").allowed).toBe(false);
  });

  it("a cap with no price in the intent denies", () => {
    expect(evaluatePolicy([market("1 USDC")], ctx({ intent: { capability: "hire" } })).reasons).toEqual(["price required: maxPrice.perRequest is set and the intent has no price"]);
  });
});

describe("B5: missing context for a rule that exists denies, naming the field", () => {
  it("max-transaction, daily or approval rules with no asset: asset required", () => {
    for (const rules of [{ maxTransaction: { USDC: "5" } }, { dailySpend: { USDC: "5" } }, { humanApprovalThreshold: { USDC: "5" } }]) {
      const result = evaluatePolicy([selfPolicy(rules)], ctx({ intent: { capability: "pay", amount: "10" } }));
      expect(result.allowed, JSON.stringify(rules)).toBe(false);
      expect(result.approvalsRequired).toEqual([]);
      expect(result.reasons[0]).toMatch(/^asset required/);
    }
  });

  it("the same rules with no amount: amount required", () => {
    const result = evaluatePolicy([selfPolicy({ maxTransaction: { USDC: "5" } })], ctx({ intent: { capability: "pay", asset: "USDC" } }));
    expect(result.reasons).toEqual(["amount required: maxTransaction is set and the intent has no amount"]);
  });

  it("self allow-lists with the field missing", () => {
    const deny = (rules: Policy<"self">["rules"], field: string) => {
      const result = evaluatePolicy([selfPolicy(rules)], ctx({ intent: { capability: "pay" } }));
      expect(result.reasons[0]).toMatch(new RegExp(`^${field} required`));
    };
    deny({ allowedAssets: ["USDC"] }, "asset");
    deny({ allowedProtocols: ["uniswap"] }, "protocol");
    deny({ allowedContracts: ["0xabc"] }, "contract");
  });

  it("execution allow-lists with the field missing", () => {
    const cases: [Policy<"execution">["rules"], string][] = [
      [{ allowedChains: ["base"] }, "chain"],
      [{ allowedWalletProviders: ["safe"] }, "walletProvider"],
      [{ allowedPaymentRails: ["stripe"] }, "paymentRail"],
      [{ allowedProtocols: ["uniswap"] }, "protocol"],
    ];
    for (const [rules, field] of cases) {
      const result = evaluatePolicy([{ id: "p", kind: "execution", version: 1, scope: {}, rules }], ctx({ intent: { capability: "pay" } }));
      expect(result.allowed, field).toBe(false);
      expect(result.reasons).toEqual([`${field} required: ${Object.keys(rules)[0]} is set and the intent has no ${field}`]);
    }
  });

  it("minSLA with no successRate: not enough evidence", () => {
    const sla: Policy<"market"> = { id: "p", kind: "market", version: 1, scope: {}, rules: { minSLA: { successRate: 0.9 } } };
    expect(evaluatePolicy([sla], ctx({ counterparty: { id: "x" } })).reasons[0]).toMatch(/^not enough evidence/);
    expect(evaluatePolicy([sla], ctx()).allowed).toBe(false);
    expect(evaluatePolicy([sla], ctx({ counterparty: { id: "x", successRate: 0.95 } })).allowed).toBe(true);
    expect(evaluatePolicy([sla], ctx({ counterparty: { id: "x", successRate: 0.8 } })).allowed).toBe(false);
  });

  it("a minSLA of 0 survives a merge", () => {
    const zero: Policy<"market"> = { id: "a", kind: "market", version: 1, scope: {}, rules: { minSLA: { successRate: 0 } } };
    const other: Policy<"market"> = { id: "b", kind: "market", version: 1, scope: {}, rules: { maxSlippage: 1 } };
    expect(evaluatePolicy([zero, other], ctx({ intent: { capability: "swap", slippage: 0 } })).reasons[0]).toMatch(/^not enough evidence/);
  });

  it("market currency and slippage rules with the field missing", () => {
    const m = (rules: Policy<"market">["rules"]): Policy<"market"> => ({ id: "p", kind: "market", version: 1, scope: {}, rules });
    expect(evaluatePolicy([m({ allowedCurrencies: ["USDC"] })], ctx({ intent: { capability: "hire" } })).reasons[0]).toMatch(/^asset required/);
    expect(evaluatePolicy([m({ maxSlippage: 0.01 })], ctx({ intent: { capability: "swap" } })).reasons[0]).toMatch(/^slippage required/);
  });

  it("a blocklist with no counterparty: counterparty required", () => {
    const block: Policy<"counterparty"> = { id: "p", kind: "counterparty", version: 1, scope: {}, rules: { blocklist: ["bad"] } };
    expect(evaluatePolicy([block], ctx()).reasons).toEqual(["counterparty required: blocklist is set and the context has no counterparty"]);
    expect(evaluatePolicy([block], ctx({ counterparty: { id: "good" } })).allowed).toBe(true);
  });

  it("no rule at all still restricts nothing", () => {
    expect(evaluatePolicy([selfPolicy({})], ctx({ intent: { capability: "pay" } })).allowed).toBe(true);
  });
});
