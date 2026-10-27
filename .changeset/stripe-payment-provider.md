---
"@adasouls/provider-adapters": minor
---

Add `StripePaymentProvider`, a `PaymentProvider` for card payments in Stripe test mode. `verify(reference)` reads a PaymentIntent and returns its status, amount, currency, creation time, `livemode` and `metadata.action_id`. `pay()` creates and confirms a PaymentIntent server-side, with no redirect, using a Stripe test card and the action id as metadata and idempotency key. It refuses to start with a live key (`sk_live_`, `rk_live_`) or anything that isn't a test key, and refuses any PaymentIntent with `livemode: true`. It logs nothing, and its results and errors carry no keys or raw Stripe objects.
