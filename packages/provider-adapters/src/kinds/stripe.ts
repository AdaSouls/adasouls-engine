import Stripe from "stripe";
import type { PaymentProvider, PaymentRecord, PaymentRequest } from "../types.js";

/**
 * Onboarding checklist per 09-custody-and-key-management.md:
 *
 * 1. Authorization model: a Stripe secret or restricted key, held by the
 *    organization and passed in per provider instance. Test mode only:
 *    the constructor refuses anything but an sk_test_/rk_test_ key, and
 *    any PaymentIntent that comes back with livemode: true is refused
 *    rather than returned, so no real card is ever charged through here.
 * 2. Revocation: the organization rolls or deletes the key in its Stripe
 *    Dashboard, independent of AdaSouls.
 * 3. Independent limit enforcement: none. Stripe doesn't cap what a key
 *    may charge, so policy-engine's checks are the only limit; a
 *    restricted key scoped to PaymentIntents narrows what a leaked key
 *    can do, not how much.
 * 4. Failure semantics: pay() creates and confirms in one call, server
 *    side, with redirect-based payment methods turned off
 *    (automatic_payment_methods.allow_redirects: "never", so no
 *    return_url is needed) and error_on_requires_action, so it ends
 *    succeeded, processing, or throws. A decline throws a
 *    StripeAdapterError naming the PaymentIntent, which verify() can
 *    read. The action id is the idempotency key: retrying pay() for one
 *    action never charges twice.
 *
 * Nothing here logs. Keys and whole Stripe objects never leave this
 * file: results are the PaymentRecord fields only, and errors keep
 * Stripe's message and codes, not its raw response.
 */

/** The PaymentIntents calls this adapter makes -- the real client's, or a stand-in in tests. */
export type StripePaymentIntents = Pick<Stripe["paymentIntents"], "create" | "retrieve">;

export interface StripePaymentProviderOptions {
  /** Replaces the Stripe client's PaymentIntents resource, for tests. The key is still checked. */
  paymentIntents?: StripePaymentIntents;
  /** The test PaymentMethod pay() charges. Defaults to pm_card_visa, which always succeeds. */
  paymentMethod?: string;
}

const TEST_KEY = /^(sk|rk)_test_[A-Za-z0-9]+$/;
const LIVE_KEY = /^(sk|rk)_live_/;
const TEST_PAYMENT_METHOD = /^pm_card_[A-Za-z0-9_]+$/;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/;
const CURRENCY = /^[a-z]{3}$/;

/** Thrown for anything Stripe refuses, with only what is safe to log. */
export class StripeAdapterError extends Error {
  readonly code?: string;
  readonly declineCode?: string;
  readonly type?: string;
  readonly requestId?: string;
  /** The PaymentIntent the failure is about, when Stripe names one: verify() reads it. */
  readonly paymentIntentId?: string;

  constructor(message: string, detail: { code?: string; declineCode?: string; type?: string; requestId?: string; paymentIntentId?: string } = {}) {
    super(message);
    this.name = "StripeAdapterError";
    Object.assign(this, detail);
  }
}

/** Refuses a live key outright, and anything else that isn't a test secret or restricted key. Never echoes the key. */
export function assertStripeTestKey(key: unknown): asserts key is string {
  if (typeof key === "string" && LIVE_KEY.test(key)) {
    throw new StripeAdapterError("refusing a live Stripe key: this adapter runs in test mode only (sk_test_ or rk_test_)");
  }
  if (typeof key !== "string" || !TEST_KEY.test(key)) {
    throw new StripeAdapterError("not a Stripe test secret or restricted key (sk_test_ or rk_test_)");
  }
}

function fromStripeError(err: unknown): unknown {
  if (!(err instanceof Stripe.errors.StripeError)) return err;
  const paymentIntentId = (err.raw as { payment_intent?: { id?: unknown } } | undefined)?.payment_intent?.id;
  return new StripeAdapterError(`Stripe: ${err.message}`, {
    code: err.code,
    declineCode: err.decline_code,
    type: err.type,
    requestId: err.requestId,
    paymentIntentId: typeof paymentIntentId === "string" ? paymentIntentId : undefined,
  });
}

function toRecord(pi: Stripe.PaymentIntent): PaymentRecord {
  if (pi.livemode !== false) throw new StripeAdapterError(`refusing PaymentIntent ${pi.id}: it is in live mode`, { paymentIntentId: pi.id });
  const actionId = pi.metadata?.action_id;
  return {
    reference: pi.id,
    status: pi.status,
    amount: pi.amount,
    currency: pi.currency,
    createdAt: new Date(pi.created * 1000).toISOString(),
    livemode: false,
    ...(actionId ? { actionId } : {}),
  };
}

export class StripePaymentProvider implements PaymentProvider {
  // A private field, so inspecting or serializing the provider shows neither the client nor the key it holds.
  readonly #paymentIntents: StripePaymentIntents;
  readonly #paymentMethod: string;

  constructor(secretKey: string, options: StripePaymentProviderOptions = {}) {
    assertStripeTestKey(secretKey);
    const paymentMethod = options.paymentMethod ?? "pm_card_visa";
    if (!TEST_PAYMENT_METHOD.test(paymentMethod)) {
      throw new StripeAdapterError(`paymentMethod must be a Stripe test PaymentMethod (pm_card_...), got "${paymentMethod}"`);
    }
    this.#paymentMethod = paymentMethod;
    this.#paymentIntents = options.paymentIntents ?? new Stripe(secretKey, { maxNetworkRetries: 2 }).paymentIntents;
  }

  async verify(reference: string): Promise<PaymentRecord> {
    if (typeof reference !== "string" || !PAYMENT_INTENT_ID.test(reference)) {
      throw new StripeAdapterError(`not a PaymentIntent id: "${String(reference)}"`);
    }
    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.#paymentIntents.retrieve(reference);
    } catch (err) {
      throw fromStripeError(err);
    }
    return toRecord(pi);
  }

  async pay(request: PaymentRequest): Promise<PaymentRecord> {
    const { actionId, amount, currency, description } = request;
    if (typeof actionId !== "string" || actionId.length === 0 || actionId.length > 500) {
      throw new StripeAdapterError("actionId must be a non-empty string of at most 500 characters (Stripe's metadata limit)");
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new StripeAdapterError(`amount must be a positive integer in the currency's smallest unit, got ${String(amount)}`);
    }
    if (typeof currency !== "string" || !CURRENCY.test(currency)) {
      throw new StripeAdapterError(`currency must be a lowercase ISO 4217 code, got "${String(currency)}"`);
    }

    let pi: Stripe.PaymentIntent;
    try {
      pi = await this.#paymentIntents.create(
        {
          amount,
          currency,
          ...(description ? { description } : {}),
          payment_method: this.#paymentMethod,
          confirm: true,
          // Server-side confirmation with no customer present: payment
          // methods that need a redirect are filtered out, so no
          // return_url is needed, and one that would need 3D Secure
          // fails instead of waiting for someone to authenticate.
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          error_on_requires_action: true,
          metadata: { action_id: actionId },
        },
        { idempotencyKey: `adasouls-pay-${actionId}` }
      );
    } catch (err) {
      throw fromStripeError(err);
    }

    const record = toRecord(pi);
    // A replayed idempotency key returns the first response: make sure it is this payment.
    if (record.actionId !== actionId || record.amount !== amount || record.currency !== currency) {
      throw new StripeAdapterError(`PaymentIntent ${pi.id} doesn't match the payment requested for action ${actionId}`, { paymentIntentId: pi.id });
    }
    return record;
  }
}
