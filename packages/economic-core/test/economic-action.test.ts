import { describe, expect, it } from "vitest";
import {
  createEconomicAction,
  transition,
  isLegalTransition,
  ECONOMIC_ACTION_STATUSES,
  type EconomicAction,
  type EconomicActionStatus,
} from "../src/economic-action.js";
import { EconomicCoreError } from "../src/errors.js";

const ACTOR = { type: "agent" as const, id: "alma:main:agent:treasury-01" };

function freshAction(): EconomicAction {
  return createEconomicAction({
    principalId: "alma:main:org:acme-labs",
    agentId: "alma:main:agent:treasury-01",
    intent: { capability: "pay", amount: "10", asset: "USDC", to: "agent_456" },
    capability: "pay",
    authority: { delegationId: "del_abc123" },
    actor: ACTOR,
  }).action;
}

describe("createEconomicAction", () => {
  it("creates a fresh action in the created state, with one audit event", () => {
    const { action, audit } = createEconomicAction({
      principalId: "alma:main:org:acme-labs",
      agentId: "alma:main:agent:treasury-01",
      intent: { capability: "pay", amount: "10", asset: "USDC", to: "agent_456" },
      capability: "pay",
      authority: { delegationId: "del_abc123" },
      actor: ACTOR,
    });
    expect(action.status).toBe("created");
    expect(action.audit.events).toHaveLength(1);
    expect(audit.economicActionId).toBe(action.id);
    expect(audit.type).toBe("EconomicActionCreated");
    expect(action.policyEvaluation).toBeUndefined();
    expect(action.execution).toBeUndefined();
  });

  it("fails loudly, naming the field, on missing required input", () => {
    expect(() =>
      createEconomicAction({
        principalId: "",
        agentId: "alma:main:agent:treasury-01",
        intent: { capability: "pay" },
        capability: "pay",
        authority: { delegationId: "del_abc123" },
        actor: ACTOR,
      })
    ).toThrow(EconomicCoreError);
  });
});

describe("legal transitions — every one of the nine from the state diagram", () => {
  it("created -> rejected", () => {
    const result = transition(freshAction(), "rejected", { actor: ACTOR });
    expect(result.action.status).toBe("rejected");
  });

  it("created -> pending_approval", () => {
    const result = transition(freshAction(), "pending_approval", { actor: ACTOR });
    expect(result.action.status).toBe("pending_approval");
  });

  it("created -> authorized", () => {
    const result = transition(freshAction(), "authorized", { actor: ACTOR });
    expect(result.action.status).toBe("authorized");
  });

  it("pending_approval -> authorized", () => {
    const pending = transition(freshAction(), "pending_approval", { actor: ACTOR }).action;
    const result = transition(pending, "authorized", { actor: ACTOR });
    expect(result.action.status).toBe("authorized");
  });

  it("pending_approval -> rejected", () => {
    const pending = transition(freshAction(), "pending_approval", { actor: ACTOR }).action;
    const result = transition(pending, "rejected", { actor: ACTOR });
    expect(result.action.status).toBe("rejected");
  });

  it("authorized -> executing", () => {
    const authorized = transition(freshAction(), "authorized", { actor: ACTOR }).action;
    const result = transition(authorized, "executing", { actor: ACTOR });
    expect(result.action.status).toBe("executing");
  });

  it("executing -> confirmed", () => {
    const authorized = transition(freshAction(), "authorized", { actor: ACTOR }).action;
    const executing = transition(authorized, "executing", { actor: ACTOR }).action;
    const result = transition(executing, "confirmed", { actor: ACTOR });
    expect(result.action.status).toBe("confirmed");
  });

  it("executing -> failed", () => {
    const authorized = transition(freshAction(), "authorized", { actor: ACTOR }).action;
    const executing = transition(authorized, "executing", { actor: ACTOR }).action;
    const result = transition(executing, "failed", { actor: ACTOR });
    expect(result.action.status).toBe("failed");
  });

  it("confirmed -> reversed", () => {
    const authorized = transition(freshAction(), "authorized", { actor: ACTOR }).action;
    const executing = transition(authorized, "executing", { actor: ACTOR }).action;
    const confirmed = transition(executing, "confirmed", { actor: ACTOR }).action;
    const result = transition(confirmed, "reversed", { actor: ACTOR });
    expect(result.action.status).toBe("reversed");
  });

  it("each transition appends exactly one audit event and preserves prior ones", () => {
    const created = freshAction();
    expect(created.audit.events).toHaveLength(1);
    const { action: authorized, audit } = transition(created, "authorized", { actor: ACTOR });
    expect(authorized.audit.events).toHaveLength(2);
    expect(authorized.audit.events[0]).toBe(created.audit.events[0]);
    expect(authorized.audit.events[1]).toBe(audit.id);
    expect(audit.detail).toMatchObject({ from: "created", to: "authorized" });
  });

  it("a patch merges execution data alongside the status change", () => {
    const authorized = transition(freshAction(), "authorized", { actor: ACTOR }).action;
    const { action: executing } = transition(authorized, "executing", {
      actor: { type: "system", id: "adasouls-worker" },
      patch: { execution: { providerId: "crossmint", providerRef: "tx_1" } },
    });
    expect(executing.execution).toEqual({ providerId: "crossmint", providerRef: "tx_1" });
  });
});

describe("illegal transitions — exhaustive sweep over every (from, to) pair not on the diagram", () => {
  const LEGAL_PAIRS = new Set(
    ECONOMIC_ACTION_STATUSES.flatMap((from) =>
      ECONOMIC_ACTION_STATUSES.filter((to) => isLegalTransition(from, to)).map((to) => `${from}->${to}`)
    )
  );

  for (const from of ECONOMIC_ACTION_STATUSES) {
    for (const to of ECONOMIC_ACTION_STATUSES) {
      if (LEGAL_PAIRS.has(`${from}->${to}`)) continue;

      it(`rejects ${from} -> ${to}`, () => {
        const action: EconomicAction = { ...freshAction(), status: from as EconomicActionStatus };
        expect(() => transition(action, to as EconomicActionStatus, { actor: ACTOR })).toThrow(EconomicCoreError);
      });
    }
  }

  it("terminal states (rejected, failed, reversed) have zero legal next states", () => {
    for (const terminal of ["rejected", "failed", "reversed"] as const) {
      for (const to of ECONOMIC_ACTION_STATUSES) {
        expect(isLegalTransition(terminal, to)).toBe(false);
      }
    }
  });

  it("confirmed is terminal except for the one reversal edge", () => {
    for (const to of ECONOMIC_ACTION_STATUSES) {
      expect(isLegalTransition("confirmed", to)).toBe(to === "reversed");
    }
  });
});
