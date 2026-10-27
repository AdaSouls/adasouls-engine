import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StripeAdapterError, StripePaymentProvider } from "../src/kinds/stripe.js";

/**
 * Against Stripe's test mode, for real. NOT run by default (excluded in
 * vitest.config.ts): needs a test-mode key, STRIPE_TEST_SECRET_KEY
 * (sk_test_... or a restricted rk_test_... with PaymentIntents write).
 *   STRIPE_TEST_SECRET_KEY=sk_test_... npm run test:stripe
 */
const key = process.env.STRIPE_TEST_SECRET_KEY;

if (!key) {
  describe.skip("StripePaymentProvider (test mode) -- skipped, set STRIPE_TEST_SECRET_KEY to run", () => {
    it("skipped", () => {});
  });
} else {
  describe("StripePaymentProvider (test mode)", () => {
    it("pays with a test card, and verify() reads back the same payment", async () => {
      const provider = new StripePaymentProvider(key);
      const actionId = `act_test_${randomUUID()}`;
      const paid = await provider.pay({ actionId, amount: 150, currency: "usd", description: "adasouls-engine test" });
      expect(paid).toMatchObject({ status: "succeeded", amount: 150, currency: "usd", livemode: false, actionId });
      expect(paid.reference).toMatch(/^pi_/);

      expect(await provider.verify(paid.reference)).toEqual(paid);
      // The same action again is the same payment, not a second charge.
      expect(await provider.pay({ actionId, amount: 150, currency: "usd", description: "adasouls-engine test" })).toEqual(paid);
    });

    it("a declined test card throws with the PaymentIntent id", async () => {
      const provider = new StripePaymentProvider(key, { paymentMethod: "pm_card_visa_chargeDeclined" });
      const error = await provider.pay({ actionId: `act_test_${randomUUID()}`, amount: 150, currency: "usd" }).catch((e) => e);
      expect(error).toBeInstanceOf(StripeAdapterError);
      expect(error).toMatchObject({ code: "card_declined" });
      expect((await provider.verify(error.paymentIntentId)).status).toBe("requires_payment_method");
    });
  });
}
