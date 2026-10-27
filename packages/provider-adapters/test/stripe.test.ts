import { inspect } from "node:util";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeAdapterError, StripePaymentProvider, assertStripeTestKey, type StripePaymentIntents } from "../src/kinds/stripe.js";

const TEST_KEY = "sk_test_51abcDEFghiJKLmnoPQRstuVWXyz0123456789";

function paymentIntent(overrides: Partial<Stripe.PaymentIntent> = {}): Stripe.PaymentIntent {
  return {
    id: "pi_3TestIntent",
    object: "payment_intent",
    amount: 1250,
    currency: "usd",
    created: 1793059200, // 2026-10-27T00:00:00Z
    livemode: false,
    status: "succeeded",
    metadata: { action_id: "act_123" },
    client_secret: "pi_3TestIntent_secret_shouldNeverLeave",
    ...overrides,
  } as Stripe.PaymentIntent;
}

/** A stand-in for stripe.paymentIntents that records what it was asked and answers with `result`. */
function fakePaymentIntents(result: Stripe.PaymentIntent | Error = paymentIntent()) {
  const calls: { method: string; args: unknown[] }[] = [];
  const answer = async (method: string, args: unknown[]) => {
    calls.push({ method, args });
    if (result instanceof Error) throw result;
    return result;
  };
  const api = {
    create: (...args: unknown[]) => answer("create", args),
    retrieve: (...args: unknown[]) => answer("retrieve", args),
  } as unknown as StripePaymentIntents;
  return { api, calls };
}

describe("Stripe adapter: test mode only", () => {
  it("refuses to start with a live secret or restricted key, without echoing it", () => {
    for (const key of ["sk_live_51abcSECRET", "rk_live_51abcSECRET"]) {
      let error: unknown;
      try {
        new StripePaymentProvider(key);
      } catch (e) {
        error = e;
      }
      expect(error, key).toBeInstanceOf(StripeAdapterError);
      expect((error as Error).message).toMatch(/refusing a live Stripe key/);
      expect((error as Error).message).not.toContain("SECRET");
    }
  });

  it("refuses anything that isn't a test secret or restricted key", () => {
    for (const key of ["", "pk_test_abc", "sk_test_", "whsec_abc", "sk_test_abc def", undefined, 42]) {
      expect(() => assertStripeTestKey(key), String(key)).toThrow(/not a Stripe test secret or restricted key/);
    }
    expect(() => assertStripeTestKey("rk_test_51abc")).not.toThrow();
    expect(() => assertStripeTestKey(TEST_KEY)).not.toThrow();
  });

  it("refuses a payment method that isn't a Stripe test one", () => {
    expect(() => new StripePaymentProvider(TEST_KEY, { paymentMethod: "pm_1RealSavedCard" })).toThrow(/test PaymentMethod/);
  });

  it("refuses a live-mode PaymentIntent from verify() and pay()", async () => {
    const { api } = fakePaymentIntents(paymentIntent({ livemode: true }));
    const provider = new StripePaymentProvider(TEST_KEY, { paymentIntents: api });
    await expect(provider.verify("pi_3TestIntent")).rejects.toThrow(/live mode/);
    await expect(provider.pay({ actionId: "act_123", amount: 1250, currency: "usd" })).rejects.toThrow(/live mode/);
  });

  it("neither inspecting nor serializing the provider shows the key", () => {
    const provider = new StripePaymentProvider(TEST_KEY);
    expect(inspect(provider, { depth: 10, showHidden: true })).not.toContain(TEST_KEY);
    expect(JSON.stringify(provider)).not.toContain(TEST_KEY);
  });
});

describe("Stripe adapter: verify()", () => {
  it("reads the PaymentIntent and returns only the record's fields", async () => {
    const { api, calls } = fakePaymentIntents();
    const record = await new StripePaymentProvider(TEST_KEY, { paymentIntents: api }).verify("pi_3TestIntent");
    expect(calls).toEqual([{ method: "retrieve", args: ["pi_3TestIntent"] }]);
    expect(record).toEqual({
      reference: "pi_3TestIntent",
      status: "succeeded",
      amount: 1250,
      currency: "usd",
      createdAt: "2026-10-27T00:00:00.000Z",
      livemode: false,
      actionId: "act_123",
    });
    expect(JSON.stringify(record)).not.toContain("secret");
  });

  it("a PaymentIntent with no action_id has no actionId", async () => {
    const { api } = fakePaymentIntents(paymentIntent({ metadata: {} }));
    const record = await new StripePaymentProvider(TEST_KEY, { paymentIntents: api }).verify("pi_3TestIntent");
    expect(record.actionId).toBeUndefined();
  });

  it("refuses a reference that isn't a PaymentIntent id, without calling Stripe", async () => {
    const { api, calls } = fakePaymentIntents();
    const provider = new StripePaymentProvider(TEST_KEY, { paymentIntents: api });
    for (const ref of ["", "ch_123", "pi_123/../../charges", "pi_"]) await expect(provider.verify(ref), ref).rejects.toThrow(/not a PaymentIntent id/);
    expect(calls).toEqual([]);
  });
});

describe("Stripe adapter: pay()", () => {
  it("creates and confirms server-side with a test card, no redirects, the action id as metadata and idempotency key", async () => {
    const { api, calls } = fakePaymentIntents();
    const record = await new StripePaymentProvider(TEST_KEY, { paymentIntents: api }).pay({ actionId: "act_123", amount: 1250, currency: "usd" });
    expect(calls).toEqual([
      {
        method: "create",
        args: [
          {
            amount: 1250,
            currency: "usd",
            payment_method: "pm_card_visa",
            confirm: true,
            automatic_payment_methods: { enabled: true, allow_redirects: "never" },
            error_on_requires_action: true,
            metadata: { action_id: "act_123" },
          },
          { idempotencyKey: "adasouls-pay-act_123" },
        ],
      },
    ]);
    expect(record).toMatchObject({ reference: "pi_3TestIntent", status: "succeeded", actionId: "act_123", livemode: false });
  });

  it("checks its input before calling Stripe", async () => {
    const { api, calls } = fakePaymentIntents();
    const provider = new StripePaymentProvider(TEST_KEY, { paymentIntents: api });
    await expect(provider.pay({ actionId: "", amount: 100, currency: "usd" })).rejects.toThrow(/actionId/);
    for (const amount of [0, -1, 12.5, Number.NaN, 2 ** 60]) {
      await expect(provider.pay({ actionId: "a", amount, currency: "usd" }), String(amount)).rejects.toThrow(/amount must be a positive integer/);
    }
    for (const currency of ["USD", "us", "dollars"]) {
      await expect(provider.pay({ actionId: "a", amount: 100, currency }), currency).rejects.toThrow(/currency/);
    }
    expect(calls).toEqual([]);
  });

  it("refuses a result that isn't the payment asked for (a reused idempotency key)", async () => {
    const { api } = fakePaymentIntents(paymentIntent({ amount: 999 }));
    await expect(new StripePaymentProvider(TEST_KEY, { paymentIntents: api }).pay({ actionId: "act_123", amount: 1250, currency: "usd" })).rejects.toThrow(/doesn't match/);
  });

  it("a decline throws Stripe's message and codes and the PaymentIntent id, not the raw response", async () => {
    const declined = new Stripe.errors.StripeCardError({
      type: "card_error",
      message: "Your card was declined.",
      code: "card_declined",
      decline_code: "generic_decline",
      requestId: "req_abc",
      payment_intent: paymentIntent({ status: "requires_payment_method" }),
    } as never);
    const { api } = fakePaymentIntents(declined);
    let error: unknown;
    try {
      await new StripePaymentProvider(TEST_KEY, { paymentIntents: api }).pay({ actionId: "act_123", amount: 1250, currency: "usd" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(StripeAdapterError);
    expect(error).toMatchObject({ message: "Stripe: Your card was declined.", code: "card_declined", declineCode: "generic_decline", paymentIntentId: "pi_3TestIntent" });
    expect(inspect(error, { depth: 10 })).not.toContain("client_secret");
  });
});
