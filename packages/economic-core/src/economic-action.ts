import { EconomicCoreError } from "./errors.js";
import { randomId } from "./id.js";

/**
 * The state machine below is the audit backbone of the whole system
 * (ADR-005) -- every transition, legal or not, matters. Source of truth:
 * docs/10-economic-action-lifecycle.md's mermaid diagram, reproduced here
 * as a transition table so it's enforceable, not just documented.
 *
 *   created -> rejected            (policy denies, no approval path)
 *   created -> pending_approval    (policy requires approval)
 *   created -> authorized          (policy allows outright)
 *   pending_approval -> authorized (approval granted)
 *   pending_approval -> rejected   (approval rejected or expired)
 *   authorized -> executing        (worker picks up job)
 *   executing -> confirmed         (provider confirms)
 *   executing -> failed            (provider error / timeout)
 *   confirmed -> reversed          (rare -- chargeback/refund path)
 *
 * failed, rejected, and reversed are fully terminal. confirmed is
 * terminal except for the rare reversal path -- it is NOT symmetric with
 * the other terminal states, so it keeps one outgoing edge.
 */
export const ECONOMIC_ACTION_STATUSES = [
  "created",
  "pending_approval",
  "authorized",
  "rejected",
  "executing",
  "confirmed",
  "failed",
  "reversed",
] as const;
export type EconomicActionStatus = (typeof ECONOMIC_ACTION_STATUSES)[number];

const LEGAL_TRANSITIONS: Record<EconomicActionStatus, readonly EconomicActionStatus[]> = {
  created: ["rejected", "pending_approval", "authorized"],
  pending_approval: ["authorized", "rejected"],
  authorized: ["executing"],
  executing: ["confirmed", "failed"],
  confirmed: ["reversed"],
  rejected: [],
  failed: [],
  reversed: [],
};

export function isLegalTransition(from: EconomicActionStatus, to: EconomicActionStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * The agent's declared desire, prior to any policy evaluation. Shape only
 * -- economic-core doesn't interpret capability/amount/asset semantics,
 * it just carries them through the state machine and audit trail.
 */
export interface EconomicIntent {
  capability: string;
  amount?: string;
  asset?: string;
  to?: string;
  detail?: Record<string, unknown>;
}

export interface CounterpartyRef {
  /** An ALMA identifier. */
  id: string;
  role?: string;
}

export interface PolicyRef {
  id: string;
  version: number;
}

/**
 * Shape only in Phase 2 -- policy-engine (Phase 4) is what actually
 * produces one of these. economic-core just has somewhere to put it once
 * it exists.
 */
export interface PolicyEvaluation {
  allowed: boolean;
  reasons: string[];
  approvalsRequired: string[];
}

/** Shape only in Phase 2 -- provider-adapters (Phase 5) produces this. */
export interface ExecutionPlan {
  providerId: string;
  route: string;
  estimatedCost?: string;
  estimatedSlippage?: string;
}

export interface ApprovalRequestRef {
  id: string;
  status: "pending" | "granted" | "rejected" | "expired";
}

export interface ExecutionRef {
  providerId: string;
  /** The provider's own tx/job id. */
  providerRef: string;
  chain?: string;
  txHash?: string;
}

/**
 * The system-of-record object for one attempted economic operation, from
 * intent through settlement -- the primary execution and audit primitive
 * of the whole system (ADR-005, docs/01-domain-model.md).
 *
 * Unlike docs/01-domain-model.md's illustrative interface, every field
 * populated by a later phase (policyEvaluation, executionPlan, approval,
 * execution) is optional here -- Phase 2 has no policy engine or provider
 * adapters yet, so a freshly created EconomicAction genuinely doesn't have
 * them.
 */
export interface EconomicAction {
  id: string;
  principalId: string;
  agentId: string;
  agentInstanceId?: string;
  intent: EconomicIntent;
  capability: string;
  counterparty?: CounterpartyRef;
  authority: { delegationId: string; policySnapshot: PolicyRef[] };
  policyEvaluation?: PolicyEvaluation;
  executionPlan?: ExecutionPlan;
  approval?: ApprovalRequestRef;
  execution?: ExecutionRef;
  status: EconomicActionStatus;
  result?: Record<string, unknown>;
  /**
   * Set when a provider call returns an ambiguous outcome (submitted but
   * not yet confirmed, or the provider couldn't say definitively) --
   * per docs/10-economic-action-lifecycle.md: "modeled as `executing`
   * with a `needsReconciliation` flag" rather than a separate status, so
   * it doesn't need its own transitions in the table above. The caller
   * (adasouls-worker, Phase 6) polls the provider for ground truth and
   * clears this via a patch once resolved, rather than blindly retrying
   * a possibly-already-submitted transaction.
   */
  needsReconciliation?: boolean;
  audit: { createdAt: string; events: string[] };
}

/**
 * Append-only record of one state transition (or the initial creation) of
 * an EconomicAction. economic-core only *constructs* these as return
 * values -- per adasouls-engine/REPOSITORY.md, it never persists or
 * publishes them; the caller (adasouls-api / adasouls-worker) does.
 */
export interface AuditRecord {
  id: string;
  economicActionId: string;
  type: string;
  occurredAt: string;
  actor: { type: "agent" | "user" | "system" | "provider"; id: string };
  detail: Record<string, unknown>;
}

export interface AuditActor {
  type: "agent" | "user" | "system" | "provider";
  id: string;
}

export interface CreateEconomicActionInput {
  principalId: string;
  agentId: string;
  agentInstanceId?: string;
  intent: EconomicIntent;
  capability: string;
  counterparty?: CounterpartyRef;
  authority: { delegationId: string; policySnapshot?: PolicyRef[] };
  actor: AuditActor;
}

export interface CreateEconomicActionResult {
  action: EconomicAction;
  audit: AuditRecord;
}

function requireNonEmpty(field: string, value: string | undefined): asserts value is string {
  if (!value || value.trim().length === 0) {
    throw new EconomicCoreError(field, "must be a non-empty string");
  }
}

export function createEconomicAction(input: CreateEconomicActionInput): CreateEconomicActionResult {
  requireNonEmpty("principalId", input.principalId);
  requireNonEmpty("agentId", input.agentId);
  requireNonEmpty("capability", input.capability);
  requireNonEmpty("intent.capability", input.intent?.capability);
  requireNonEmpty("authority.delegationId", input.authority?.delegationId);

  const id = randomId("eco");
  const createdAt = new Date().toISOString();
  const auditId = randomId("aud");

  const action: EconomicAction = {
    id,
    principalId: input.principalId,
    agentId: input.agentId,
    agentInstanceId: input.agentInstanceId,
    intent: input.intent,
    capability: input.capability,
    counterparty: input.counterparty,
    authority: { delegationId: input.authority.delegationId, policySnapshot: input.authority.policySnapshot ?? [] },
    status: "created",
    audit: { createdAt, events: [auditId] },
  };

  const audit: AuditRecord = {
    id: auditId,
    economicActionId: id,
    type: "EconomicActionCreated",
    occurredAt: createdAt,
    actor: input.actor,
    detail: { capability: input.capability },
  };

  return { action, audit };
}

export interface TransitionOptions {
  actor: AuditActor;
  detail?: Record<string, unknown>;
  /** Merged into the returned action alongside the status change (e.g. execution, result). */
  patch?: Partial<
    Pick<EconomicAction, "policyEvaluation" | "executionPlan" | "approval" | "execution" | "result" | "needsReconciliation">
  >;
}

export interface TransitionResult {
  action: EconomicAction;
  audit: AuditRecord;
}

/**
 * The only way an EconomicAction's status changes. Rejects any transition
 * not in the table above -- fails loudly and specifically (which
 * transition, why), never silently coerces or ignores an illegal request.
 */
export function transition(action: EconomicAction, to: EconomicActionStatus, options: TransitionOptions): TransitionResult {
  const from = action.status;
  if (!isLegalTransition(from, to)) {
    throw new EconomicCoreError(
      "status",
      `illegal transition from "${from}" to "${to}" (legal next states: ${
        LEGAL_TRANSITIONS[from].length ? LEGAL_TRANSITIONS[from].join(", ") : "none -- terminal"
      })`
    );
  }

  const occurredAt = new Date().toISOString();
  const auditId = randomId("aud");

  const nextAction: EconomicAction = {
    ...action,
    ...options.patch,
    status: to,
    audit: { ...action.audit, events: [...action.audit.events, auditId] },
  };

  const audit: AuditRecord = {
    id: auditId,
    economicActionId: action.id,
    type: "EconomicActionTransitioned",
    occurredAt,
    actor: options.actor,
    detail: { from, to, ...options.detail },
  };

  return { action: nextAction, audit };
}
